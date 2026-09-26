package main

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/go-git/go-git/v5"
	"github.com/go-git/go-git/v5/config"
	"github.com/go-git/go-git/v5/plumbing/object"
)

const (
	maitri              = "maitri"
	twelveHourly        = "0 */12 * * *"
	sixHourly           = "0 */6 * * *"
	schedulePatchPath   = "gitops/maitri/patches/observation-aggregate-schedule.yaml"
	approvalHeader      = "X-Dhruva-Approval"
	maxRequestBodyBytes = 16 << 10
)

// demoPrincipalRoles is deliberately small. In the production design this
// lookup is replaced by the authenticated identity provider's role claims;
// the dashboard never gets to grant itself a role in either case.
var demoPrincipalRoles = map[string]string{
	"researcher@maitri.example":   "researcher",
	"maitri.research@dhruva.demo": "researcher",
}

type scheduleRequest struct {
	RequestID  string `json:"request_id"`
	Station    string `json:"station"`
	Schedule   string `json:"schedule"`
	ApprovedBy string `json:"approved_by"`
}

type scheduleResponse struct {
	RequestID string `json:"request_id"`
	Status    string `json:"status"`
	Revision  string `json:"revision,omitempty"`
	Reason    string `json:"reason,omitempty"`
}

// changeRequest is the narrow public contract used by the dashboard. A client
// asks for an allowed schedule change, rather than supplying Kubernetes YAML.
type changeRequest struct {
	RequestID     string `json:"request_id"`
	Station       string `json:"station"`
	Workload      string `json:"workload"`
	Capability    string `json:"capability"`
	Schedule      string `json:"schedule"`
	Justification string `json:"justification,omitempty"`
	RequestedBy   string `json:"requested_by"`
	Role          string `json:"role"`
}

type requestRecord struct {
	changeRequest
	Status     string       `json:"status"`
	Reason     string       `json:"reason,omitempty"`
	ApprovedBy string       `json:"approved_by,omitempty"`
	Revision   string       `json:"revision,omitempty"`
	Audit      []auditEvent `json:"audit"`
}

type auditEvent struct {
	At       time.Time `json:"at"`
	Status   string    `json:"status"`
	Actor    string    `json:"actor"`
	Reason   string    `json:"reason,omitempty"`
	Revision string    `json:"revision,omitempty"`
}

type gatewayState struct {
	LinkUp        bool                     `json:"link_up"`
	LinkChangedAt time.Time                `json:"link_changed_at,omitempty"`
	Pending       string                   `json:"pending,omitempty"`
	Delivered     string                   `json:"delivered,omitempty"`
	Attempts      int                      `json:"attempts"`
	LastError     string                   `json:"last_error,omitempty"`
	Requests      map[string]requestRecord `json:"requests,omitempty"`
}

type server struct {
	statePath     string
	state         gatewayState
	approvalToken string
	worktree      string
	pushRemote    string
	demoControls  bool
	mu            sync.Mutex
}

func main() {
	approvalToken := os.Getenv("APPROVAL_TOKEN")
	if approvalToken == "" {
		log.Fatal("APPROVAL_TOKEN is required")
	}

	s := &server{approvalToken: approvalToken, worktree: env("GIT_WORKTREE", "."), pushRemote: env("GIT_PUSH_REMOTE", "station"), statePath: env("GATEWAY_STATE", "../gateway-state.json"), demoControls: os.Getenv("DEMO_DIRECT_CONTROLS") == "1"}
	if err := s.loadState(); err != nil {
		log.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go s.retryLoop(ctx)
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", s.healthz)
	mux.HandleFunc("POST /v1/approved-schedule-changes", s.createScheduleChange)
	mux.HandleFunc("POST /v1/change-requests", s.createChangeRequest)
	mux.HandleFunc("GET /v1/change-requests", s.listChangeRequests)
	mux.HandleFunc("GET /v1/change-requests/", s.getChangeRequest)
	mux.HandleFunc("POST /v1/change-requests/", s.decideChangeRequest)
	mux.HandleFunc("POST /v1/link", s.setLink)
	mux.HandleFunc("GET /v1/state", s.getState)
	mux.HandleFunc("GET /v1/dashboard", s.getDashboard)
	mux.HandleFunc("POST /v1/demo/summary-frequency", s.setDemoSummaryFrequency)

	addr := ":" + env("PORT", "8080")
	if s.demoControls {
		addr = "127.0.0.1" + addr
	}
	log.Printf("desired-state patch service listening on %s", addr)
	if err := http.ListenAndServe(addr, browserCORS(mux)); err != nil {
		log.Fatal(err)
	}
}

// setDemoSummaryFrequency gives the local demo a direct control without
// distributing the approval token to the browser. It is disabled by default
// and only reachable through a loopback-bound server.
func (s *server) setDemoSummaryFrequency(w http.ResponseWriter, r *http.Request) {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if !s.demoControls || err != nil || net.ParseIP(host) == nil || !net.ParseIP(host).IsLoopback() {
		http.NotFound(w, r)
		return
	}
	if !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
		http.Error(w, "application/json required", http.StatusUnsupportedMediaType)
		return
	}
	if origin := r.Header.Get("Origin"); origin != "" {
		allowed := false
		for _, candidate := range strings.Split(env("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"), ",") {
			allowed = allowed || origin == strings.TrimSpace(candidate)
		}
		if !allowed {
			http.Error(w, "origin not allowed", http.StatusForbidden)
			return
		}
	}
	var input struct {
		Hours int `json:"hours"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024)).Decode(&input); err != nil || (input.Hours != 6 && input.Hours != 12) {
		http.Error(w, "hours must be 6 or 12", http.StatusUnprocessableEntity)
		return
	}
	schedule := sixHourly
	if input.Hours == 12 {
		schedule = twelveHourly
	}
	id := fmt.Sprintf("console-%d", time.Now().UTC().UnixNano())
	record := requestRecord{changeRequest: changeRequest{RequestID: id, Station: maitri, Workload: "observation-aggregate", Capability: "aggregation-schedule", Schedule: schedule, RequestedBy: "local-demo-console"}, Status: "awaiting-sync", ApprovedBy: "local-demo-console"}
	record.addAudit("awaiting-sync", "local-demo-console", "summary frequency changed in local demo", "")
	s.mu.Lock()
	if s.state.Requests == nil {
		s.state.Requests = make(map[string]requestRecord)
	}
	s.state.Requests[id] = record
	err = s.saveState()
	s.mu.Unlock()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	revision, _, err := s.commitScheduleChange(scheduleRequest{RequestID: id, Station: maitri, Schedule: schedule, ApprovedBy: "local-demo-console"})
	s.mu.Lock()
	record = s.state.Requests[id]
	if err != nil {
		record.Status, record.Reason = "failed", err.Error()
		record.addAudit("failed", "local-demo-console", err.Error(), "")
	} else {
		record.Revision = revision
		if s.state.Delivered == revision {
			record.Status = "delivered"
		}
		record.addAudit(record.Status, "local-demo-console", "change sent through station delivery", revision)
	}
	s.state.Requests[id] = record
	saveErr := s.saveState()
	s.mu.Unlock()
	if saveErr != nil {
		http.Error(w, saveErr.Error(), http.StatusInternalServerError)
		return
	}
	if err != nil {
		writeRequestJSON(w, http.StatusConflict, record)
		return
	}
	writeRequestJSON(w, http.StatusOK, record)
}

func (s *server) createChangeRequest(w http.ResponseWriter, r *http.Request) {
	var request changeRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxRequestBodyBytes)).Decode(&request); err != nil {
		writeRequestJSON(w, http.StatusBadRequest, requestRecord{Status: "rejected", Reason: "invalid request"})
		return
	}
	if err := validateChangeRequest(request); err != nil {
		writeRequestJSON(w, http.StatusUnprocessableEntity, requestRecord{changeRequest: request, Status: "rejected", Reason: err.Error()})
		return
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	if s.state.Requests == nil {
		s.state.Requests = make(map[string]requestRecord)
	}
	if existing, found := s.state.Requests[request.RequestID]; found {
		writeRequestJSON(w, http.StatusOK, existing)
		return
	}
	record := requestRecord{changeRequest: request, Status: "pending-approval"}
	record.addAudit("pending-approval", request.RequestedBy, "request accepted", "")
	s.state.Requests[request.RequestID] = record
	if err := s.saveState(); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeRequestJSON(w, http.StatusCreated, record)
}

func validateChangeRequest(request changeRequest) error {
	if strings.TrimSpace(request.RequestID) == "" || strings.TrimSpace(request.RequestedBy) == "" {
		return errors.New("request_id and requested_by are required")
	}
	if request.Station != maitri || request.Workload != "observation-aggregate" {
		return errors.New("requested workload is not exposed at this station")
	}
	if request.Capability != "aggregation-schedule" || !allowedSchedule(request.Schedule) {
		return errors.New("requested capability or parameter is not allowed")
	}
	role, found := demoPrincipalRoles[request.RequestedBy]
	if !found || request.Role != role || role != "researcher" {
		return errors.New("role is not allowed to request this capability")
	}
	return nil
}

func (s *server) getChangeRequest(w http.ResponseWriter, r *http.Request) {
	id, action := requestPath(r.URL.Path)
	if id == "" || action != "" {
		http.NotFound(w, r)
		return
	}
	s.mu.Lock()
	record, found := s.state.Requests[id]
	s.mu.Unlock()
	if !found {
		http.NotFound(w, r)
		return
	}
	writeRequestJSON(w, http.StatusOK, record)
}

func (s *server) listChangeRequests(w http.ResponseWriter, _ *http.Request) {
	s.mu.Lock()
	records := make([]requestRecord, 0, len(s.state.Requests))
	for _, record := range s.state.Requests {
		records = append(records, record)
	}
	s.mu.Unlock()
	writeRequestJSON(w, http.StatusOK, records)
}

func (s *server) decideChangeRequest(w http.ResponseWriter, r *http.Request) {
	if !s.authorized(r) {
		writeRequestJSON(w, http.StatusUnauthorized, requestRecord{Status: "rejected", Reason: "missing or invalid approval"})
		return
	}
	id, action := requestPath(r.URL.Path)
	if id == "" || (action != "approve" && action != "reject" && action != "outcome") {
		http.NotFound(w, r)
		return
	}
	var decision struct {
		ApprovedBy string `json:"approved_by"`
		Reason     string `json:"reason"`
		Status     string `json:"status"`
		Revision   string `json:"revision"`
		Reporter   string `json:"reporter"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024)).Decode(&decision); err != nil {
		http.Error(w, "invalid decision", http.StatusBadRequest)
		return
	}
	s.mu.Lock()
	record, found := s.state.Requests[id]
	s.mu.Unlock()
	if !found {
		http.NotFound(w, r)
		return
	}
	if record.Status != "pending-approval" {
		if action != "outcome" {
			writeRequestJSON(w, http.StatusOK, record)
			return
		}
	}
	if action == "outcome" {
		if record.Status != "delivered" && record.Status != "confirmed" && record.Status != "failed" {
			writeRequestJSON(w, http.StatusConflict, requestRecord{changeRequest: record.changeRequest, Status: record.Status, Reason: "station outcome is accepted only after delivery"})
			return
		}
		if (decision.Status != "confirmed" && decision.Status != "failed") || decision.Revision != record.Revision || strings.TrimSpace(decision.Reporter) == "" {
			writeRequestJSON(w, http.StatusUnprocessableEntity, requestRecord{changeRequest: record.changeRequest, Status: record.Status, Reason: "outcome must identify its reporter, matching revision, and confirmed or failed status"})
			return
		}
		if decision.Status == "failed" && strings.TrimSpace(decision.Reason) == "" {
			writeRequestJSON(w, http.StatusUnprocessableEntity, requestRecord{changeRequest: record.changeRequest, Status: record.Status, Reason: "failed outcome requires a reason"})
			return
		}
		record.Status, record.Reason = decision.Status, decision.Reason
		record.addAudit(decision.Status, decision.Reporter, decision.Reason, decision.Revision)
		s.saveRequestRecord(record)
		writeRequestJSON(w, http.StatusOK, record)
		return
	}
	if action == "reject" {
		if strings.TrimSpace(decision.Reason) == "" {
			writeRequestJSON(w, http.StatusUnprocessableEntity, requestRecord{changeRequest: record.changeRequest, Status: "rejected", Reason: "rejection reason is required"})
			return
		}
		record.Status, record.Reason = "rejected", decision.Reason
		record.addAudit("rejected", "approver", decision.Reason, "")
		s.saveRequestRecord(record)
		writeRequestJSON(w, http.StatusOK, record)
		return
	}
	if strings.TrimSpace(decision.ApprovedBy) == "" {
		writeRequestJSON(w, http.StatusUnprocessableEntity, requestRecord{changeRequest: record.changeRequest, Status: "rejected", Reason: "approved_by is required"})
		return
	}
	revision, alreadyGenerated, err := s.commitScheduleChange(scheduleRequest{RequestID: record.RequestID, Station: record.Station, Schedule: record.Schedule, ApprovedBy: decision.ApprovedBy})
	if err != nil {
		record.Status, record.Reason = "rejected", err.Error()
		record.addAudit("rejected", decision.ApprovedBy, err.Error(), "")
		s.saveRequestRecord(record)
		writeRequestJSON(w, http.StatusConflict, record)
		return
	}
	record.ApprovedBy, record.Revision, record.Status = decision.ApprovedBy, revision, "awaiting-sync"
	if alreadyGenerated {
		record.Status = "already-generated"
	}
	s.mu.Lock()
	if s.state.Delivered == revision {
		record.Status = "delivered"
	}
	s.mu.Unlock()
	record.addAudit(record.Status, decision.ApprovedBy, "approval generated controlled Git revision", revision)
	s.saveRequestRecord(record)
	writeRequestJSON(w, http.StatusOK, record)
}

func (record *requestRecord) addAudit(status, actor, reason, revision string) {
	record.Audit = append(record.Audit, auditEvent{At: time.Now().UTC(), Status: status, Actor: actor, Reason: reason, Revision: revision})
}

func (s *server) saveRequestRecord(record requestRecord) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.state.Requests == nil {
		s.state.Requests = make(map[string]requestRecord)
	}
	s.state.Requests[record.RequestID] = record
	if err := s.saveState(); err != nil {
		log.Printf("save request record: %v", err)
	}
}

func requestPath(path string) (id, action string) {
	parts := strings.Split(strings.TrimPrefix(path, "/v1/change-requests/"), "/")
	if len(parts) == 0 || parts[0] == "" || len(parts) > 2 {
		return "", ""
	}
	if len(parts) == 2 {
		return parts[0], parts[1]
	}
	return parts[0], ""
}

func (s *server) healthz(w http.ResponseWriter, _ *http.Request) {
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) createScheduleChange(w http.ResponseWriter, r *http.Request) {
	if subtle.ConstantTimeCompare([]byte(r.Header.Get(approvalHeader)), []byte(s.approvalToken)) != 1 {
		writeJSON(w, http.StatusUnauthorized, scheduleResponse{Status: "rejected", Reason: "missing or invalid approval"})
		return
	}

	var request scheduleRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxRequestBodyBytes)).Decode(&request); err != nil {
		writeJSON(w, http.StatusBadRequest, scheduleResponse{Status: "rejected", Reason: "invalid request"})
		return
	}
	if err := validate(request); err != nil {
		writeJSON(w, http.StatusUnprocessableEntity, scheduleResponse{RequestID: request.RequestID, Status: "rejected", Reason: err.Error()})
		return
	}

	revision, alreadyGenerated, err := s.commitScheduleChange(request)
	if err != nil {
		log.Printf("request %s failed: %v", request.RequestID, err)
		writeJSON(w, http.StatusConflict, scheduleResponse{RequestID: request.RequestID, Status: "rejected", Reason: err.Error()})
		return
	}
	if alreadyGenerated {
		writeJSON(w, http.StatusOK, scheduleResponse{RequestID: request.RequestID, Status: "already-generated", Revision: revision})
		return
	}
	writeJSON(w, http.StatusCreated, scheduleResponse{RequestID: request.RequestID, Status: "awaiting-sync", Revision: revision})
}

func validate(request scheduleRequest) error {
	if strings.TrimSpace(request.RequestID) == "" {
		return errors.New("request_id is required")
	}
	if request.Station != maitri {
		return fmt.Errorf("station must be %q", maitri)
	}
	if !allowedSchedule(request.Schedule) {
		return fmt.Errorf("schedule must be %q or %q", twelveHourly, sixHourly)
	}
	if strings.TrimSpace(request.ApprovedBy) == "" {
		return errors.New("approved_by is required")
	}
	return nil
}

func (s *server) commitScheduleChange(request scheduleRequest) (revision string, alreadyGenerated bool, err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	repo, err := git.PlainOpen(s.worktree)
	if err != nil {
		return "", false, fmt.Errorf("open desired-state repository: %w", err)
	}
	if _, err := repo.Head(); err != nil {
		return "", false, errors.New("desired-state repository must have an initial commit")
	}

	worktree, err := repo.Worktree()
	if err != nil {
		return "", false, fmt.Errorf("open desired-state worktree: %w", err)
	}
	status, err := worktree.Status()
	if err != nil {
		return "", false, fmt.Errorf("check desired-state worktree: %w", err)
	}
	if !status.IsClean() {
		return "", false, errors.New("desired-state worktree is not clean")
	}

	patchFile := filepath.Join(s.worktree, schedulePatchPath)
	current, err := os.ReadFile(patchFile)
	if err != nil {
		return "", false, fmt.Errorf("read allow-listed patch: %w", err)
	}
	desired := schedulePatch(request.Schedule)
	if string(current) == desired {
		head, err := repo.Head()
		if err != nil {
			return "", false, err
		}
		return head.Hash().String(), true, nil
	}
	if string(current) != schedulePatch(twelveHourly) && string(current) != schedulePatch(sixHourly) {
		return "", false, errors.New("allow-listed patch has an unsupported schedule")
	}
	if err := os.WriteFile(patchFile, []byte(desired), 0o640); err != nil {
		return "", false, fmt.Errorf("write allow-listed patch: %w", err)
	}
	if _, err := worktree.Add(schedulePatchPath); err != nil {
		return "", false, fmt.Errorf("stage allow-listed patch: %w", err)
	}
	hours := 6
	if request.Schedule == twelveHourly {
		hours = 12
	}
	hash, err := worktree.Commit(
		fmt.Sprintf("maitri: set aggregation schedule to every %d hours\n\nRequest: %s\nApproved by: %s", hours, request.RequestID, request.ApprovedBy),
		&git.CommitOptions{Author: &object.Signature{Name: "dhruva-patch-service", Email: "patch-service@dhruva.local", When: time.Now().UTC()}},
	)
	if err != nil {
		return "", false, fmt.Errorf("commit desired-state revision: %w", err)
	}
	s.state.Pending = hash.String()
	s.state.Attempts = 0
	s.state.LastError = ""
	if err := s.saveState(); err != nil {
		return hash.String(), false, err
	}
	if s.state.LinkUp {
		s.deliverLocked()
	}
	return hash.String(), false, nil
}

func (s *server) publish(repo *git.Repository) (string, error) {
	head, err := repo.Head()
	if err != nil {
		return "", fmt.Errorf("read desired-state revision: %w", err)
	}
	if s.pushRemote == "" {
		return head.Hash().String(), nil
	}
	if _, err := repo.Remote(s.pushRemote); err != nil {
		return head.Hash().String(), fmt.Errorf("configured Git remote %q: %w", s.pushRemote, err)
	}
	err = repo.Push(&git.PushOptions{
		RemoteName: s.pushRemote,
		RefSpecs:   []config.RefSpec{config.RefSpec(head.Name().String() + ":" + head.Name().String())},
	})
	if err != nil && !errors.Is(err, git.NoErrAlreadyUpToDate) {
		return head.Hash().String(), fmt.Errorf("publish desired-state revision: %w", err)
	}
	return head.Hash().String(), nil
}

func (s *server) loadState() error {
	data, err := os.ReadFile(s.statePath)
	if errors.Is(err, os.ErrNotExist) {
		return s.saveState()
	}
	if err != nil {
		return err
	}
	return json.Unmarshal(data, &s.state)
}

func (s *server) saveState() error {
	data, err := json.MarshalIndent(s.state, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(s.statePath), 0o750); err != nil {
		return err
	}
	temporary := s.statePath + ".tmp"
	if err := os.WriteFile(temporary, data, 0o600); err != nil {
		return err
	}
	return os.Rename(temporary, s.statePath)
}

func (s *server) deliverLocked() {
	if !s.state.LinkUp || s.state.Pending == "" {
		return
	}
	s.state.Attempts++
	repo, err := git.PlainOpen(s.worktree)
	if err == nil {
		var revision string
		revision, err = s.publish(repo)
		if err == nil && revision != s.state.Pending {
			err = errors.New("revision changed during delivery")
		}
	}
	if err != nil {
		s.state.LastError = err.Error()
	} else {
		s.state.Delivered = s.state.Pending
		for id, record := range s.state.Requests {
			if record.Revision == s.state.Pending && record.Status == "awaiting-sync" {
				record.Status = "delivered"
				record.addAudit("delivered", "station-sync", "revision mirrored to the station Git cache", s.state.Pending)
				s.state.Requests[id] = record
			}
		}
		s.state.Pending = ""
		s.state.LastError = ""
	}
	if err := s.saveState(); err != nil {
		log.Printf("save gateway state: %v", err)
	}
}

func (s *server) retryLoop(ctx context.Context) {
	ticker := time.NewTicker(3 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.mu.Lock()
			s.deliverLocked()
			s.mu.Unlock()
		}
	}
}

func (s *server) authorized(r *http.Request) bool {
	return subtle.ConstantTimeCompare([]byte(r.Header.Get(approvalHeader)), []byte(s.approvalToken)) == 1
}

func (s *server) setLink(w http.ResponseWriter, r *http.Request) {
	if !s.authorized(r) {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	var input struct {
		Up *bool `json:"up"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024)).Decode(&input); err != nil || input.Up == nil {
		http.Error(w, "expected up boolean", http.StatusBadRequest)
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.state.LinkUp != *input.Up {
		s.state.LinkChangedAt = time.Now().UTC()
	}
	s.state.LinkUp = *input.Up
	if err := s.saveState(); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if s.state.LinkUp {
		s.deliverLocked()
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(s.state)
}

// getDashboard exposes only the read-only state needed by the browser. Approval
// and link-control endpoints still require the server-side approval token.
func (s *server) getDashboard(w http.ResponseWriter, _ *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	records := make([]requestRecord, 0, len(s.state.Requests))
	for _, record := range s.state.Requests {
		records = append(records, record)
	}
	currentSchedule := ""
	if patch, err := os.ReadFile(filepath.Join(s.worktree, schedulePatchPath)); err == nil {
		for _, schedule := range []string{twelveHourly, sixHourly} {
			if string(patch) == schedulePatch(schedule) {
				currentSchedule = schedule
			}
		}
	}
	writeRequestJSON(w, http.StatusOK, map[string]any{
		"workload":              map[string]string{"station": maitri, "kind": "CronJob", "name": "observation-aggregate", "desired_schedule": currentSchedule},
		"link_up":               s.state.LinkUp,
		"link_changed_at":       s.state.LinkChangedAt,
		"pending_revision":      s.state.Pending,
		"delivered_revision":    s.state.Delivered,
		"delivery_attempts":     s.state.Attempts,
		"last_error":            s.state.LastError,
		"requests":              records,
		"demo_controls_enabled": s.demoControls,
	})
}

func browserCORS(next http.Handler) http.Handler {
	origins := strings.Split(env("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"), ",")
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		for _, allowed := range origins {
			if origin != "" && origin == strings.TrimSpace(allowed) {
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
				w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
				w.Header().Set("Vary", "Origin")
				break
			}
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *server) getState(w http.ResponseWriter, r *http.Request) {
	if !s.authorized(r) {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(s.state)
}

func schedulePatch(schedule string) string {
	return "apiVersion: batch/v1\nkind: CronJob\nmetadata:\n  name: observation-aggregate\nspec:\n  schedule: \"" + schedule + "\"\n"
}

func allowedSchedule(schedule string) bool {
	return schedule == twelveHourly || schedule == sixHourly
}

func writeJSON(w http.ResponseWriter, status int, value scheduleResponse) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeRequestJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func env(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}
