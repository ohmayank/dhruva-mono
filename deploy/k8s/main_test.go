package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/go-git/go-git/v5"
	"github.com/go-git/go-git/v5/config"
	"github.com/go-git/go-git/v5/plumbing/object"
)

func TestApprovedScheduleChangeCommitsOnlyTheAllowListedPatch(t *testing.T) {
	worktree := newDesiredStateRepository(t, twelveHourly)
	remote := newBareRemote(t)
	repo, err := git.PlainOpen(worktree)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.CreateRemote(&config.RemoteConfig{Name: "origin", URLs: []string{remote}}); err != nil {
		t.Fatal(err)
	}
	server := &server{approvalToken: "approved", worktree: worktree, pushRemote: "origin", statePath: filepath.Join(t.TempDir(), "state.json"), state: gatewayState{LinkUp: true}}

	request := scheduleRequest{
		RequestID:  "sih-42",
		Station:    maitri,
		Schedule:   sixHourly,
		ApprovedBy: "operator@example.invalid",
	}
	first := doRequest(t, server, "approved", request)
	if first.Code != http.StatusCreated {
		t.Fatalf("first request status = %d, body = %s", first.Code, first.Body.String())
	}
	var response scheduleResponse
	if err := json.NewDecoder(first.Body).Decode(&response); err != nil {
		t.Fatal(err)
	}
	if response.Status != "awaiting-sync" || response.Revision == "" {
		t.Fatalf("unexpected response: %#v", response)
	}

	patch, err := os.ReadFile(filepath.Join(worktree, schedulePatchPath))
	if err != nil {
		t.Fatal(err)
	}
	if got, want := string(patch), schedulePatch(sixHourly); got != want {
		t.Fatalf("generated patch = %q, want %q", got, want)
	}

	log, err := repo.Log(&git.LogOptions{})
	if err != nil {
		t.Fatal(err)
	}
	defer log.Close()
	commit, err := log.Next()
	if err != nil {
		t.Fatal(err)
	}
	if got, want := commit.Message, "maitri: set aggregation schedule to every 6 hours\n\nRequest: sih-42\nApproved by: operator@example.invalid"; got != want {
		t.Fatalf("commit message = %q, want %q", got, want)
	}
	remoteRepo, err := git.PlainOpen(remote)
	if err != nil {
		t.Fatal(err)
	}
	remoteHead, err := remoteRepo.Reference("refs/heads/master", true)
	if err != nil {
		t.Fatal(err)
	}
	if remoteHead.Hash() != commit.Hash {
		t.Fatalf("published revision = %s, want %s", remoteHead.Hash(), commit.Hash)
	}

	second := doRequest(t, server, "approved", request)
	if second.Code != http.StatusOK {
		t.Fatalf("duplicate request status = %d, body = %s", second.Code, second.Body.String())
	}
	if err := json.NewDecoder(second.Body).Decode(&response); err != nil {
		t.Fatal(err)
	}
	if response.Status != "already-generated" || response.Revision != commit.Hash.String() {
		t.Fatalf("unexpected duplicate response: %#v", response)
	}
}

func newBareRemote(t *testing.T) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "desired-state.git")
	if _, err := git.PlainInit(path, true); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestApprovedScheduleChangeRejectsUnauthorizedAndUnsupportedRequests(t *testing.T) {
	worktree := newDesiredStateRepository(t, twelveHourly)
	server := &server{approvalToken: "approved", worktree: worktree, statePath: filepath.Join(t.TempDir(), "state.json")}
	request := scheduleRequest{RequestID: "sih-43", Station: maitri, Schedule: sixHourly, ApprovedBy: "operator@example.invalid"}

	if got := doRequest(t, server, "wrong", request).Code; got != http.StatusUnauthorized {
		t.Fatalf("unauthorized status = %d, want %d", got, http.StatusUnauthorized)
	}
	request.Schedule = "0 * * * *"
	if got := doRequest(t, server, "approved", request).Code; got != http.StatusUnprocessableEntity {
		t.Fatalf("unsupported schedule status = %d, want %d", got, http.StatusUnprocessableEntity)
	}
	patch, err := os.ReadFile(filepath.Join(worktree, schedulePatchPath))
	if err != nil {
		t.Fatal(err)
	}
	if got, want := string(patch), schedulePatch(twelveHourly); got != want {
		t.Fatalf("rejected request changed patch = %q, want %q", got, want)
	}
}

func TestChangeRequestLifecycleCreatesOnlyAnApprovedPatch(t *testing.T) {
	worktree := newDesiredStateRepository(t, twelveHourly)
	service := &server{approvalToken: "approved", worktree: worktree, statePath: filepath.Join(t.TempDir(), "state.json")}
	request := changeRequest{
		RequestID: "demo-approval-1", Station: maitri, Workload: "observation-aggregate",
		Capability: "aggregation-schedule", Schedule: sixHourly,
		RequestedBy: "researcher@example.invalid", Role: "researcher",
	}
	created := doChangeRequest(t, service, http.MethodPost, "/v1/change-requests", "", request)
	if created.Code != http.StatusCreated {
		t.Fatalf("create request: %d %s", created.Code, created.Body.String())
	}
	var pending requestRecord
	if err := json.NewDecoder(created.Body).Decode(&pending); err != nil {
		t.Fatal(err)
	}
	if pending.Status != "pending-approval" {
		t.Fatalf("request status = %q", pending.Status)
	}
	patch, err := os.ReadFile(filepath.Join(worktree, schedulePatchPath))
	if err != nil {
		t.Fatal(err)
	}
	if got, want := string(patch), schedulePatch(twelveHourly); got != want {
		t.Fatalf("pending request changed patch = %q, want %q", got, want)
	}

	approved := doJSON(t, service, http.MethodPost, "/v1/change-requests/demo-approval-1/approve", "approved", map[string]string{"approved_by": "lead@example.invalid"})
	if approved.Code != http.StatusOK {
		t.Fatalf("approve: %d %s", approved.Code, approved.Body.String())
	}
	var record requestRecord
	if err := json.NewDecoder(approved.Body).Decode(&record); err != nil {
		t.Fatal(err)
	}
	if record.Status != "awaiting-sync" || record.Revision == "" || record.ApprovedBy != "lead@example.invalid" {
		t.Fatalf("approval record = %#v", record)
	}
	patch, err = os.ReadFile(filepath.Join(worktree, schedulePatchPath))
	if err != nil {
		t.Fatal(err)
	}
	if got, want := string(patch), schedulePatch(sixHourly); got != want {
		t.Fatalf("approved request patch = %q, want %q", got, want)
	}

	restarted := &server{worktree: worktree, statePath: service.statePath}
	if err := restarted.loadState(); err != nil {
		t.Fatal(err)
	}
	loaded := doJSON(t, restarted, http.MethodGet, "/v1/change-requests/demo-approval-1", "", nil)
	if loaded.Code != http.StatusOK || !strings.Contains(loaded.Body.String(), record.Revision) {
		t.Fatalf("durable lifecycle read: %d %s", loaded.Code, loaded.Body.String())
	}
}

func TestChangeRequestRejectsUnauthorizedCapabilityAndRecordsRejection(t *testing.T) {
	service := &server{approvalToken: "approved", worktree: newDesiredStateRepository(t, twelveHourly), statePath: filepath.Join(t.TempDir(), "state.json")}
	request := changeRequest{RequestID: "demo-reject-1", Station: maitri, Workload: "observation-aggregate", Capability: "aggregation-schedule", Schedule: sixHourly, RequestedBy: "researcher", Role: "researcher"}
	if got := doChangeRequest(t, service, http.MethodPost, "/v1/change-requests", "", request).Code; got != http.StatusCreated {
		t.Fatalf("create: %d", got)
	}
	if got := doJSON(t, service, http.MethodPost, "/v1/change-requests/demo-reject-1/reject", "wrong", map[string]string{"reason": "outside shift"}).Code; got != http.StatusUnauthorized {
		t.Fatalf("unauthorized decision: %d", got)
	}
	rejected := doJSON(t, service, http.MethodPost, "/v1/change-requests/demo-reject-1/reject", "approved", map[string]string{"reason": "outside shift"})
	if rejected.Code != http.StatusOK || !strings.Contains(rejected.Body.String(), "outside shift") {
		t.Fatalf("rejection: %d %s", rejected.Code, rejected.Body.String())
	}
	request.RequestID, request.Role = "bad-role", "viewer"
	if got := doChangeRequest(t, service, http.MethodPost, "/v1/change-requests", "", request).Code; got != http.StatusUnprocessableEntity {
		t.Fatalf("role validation: %d", got)
	}
}

func TestChangeRequestTransitionsToDeliveredWhenTheLinkReturns(t *testing.T) {
	worktree := newDesiredStateRepository(t, twelveHourly)
	remote := newBareRemote(t)
	repo, err := git.PlainOpen(worktree)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.CreateRemote(&config.RemoteConfig{Name: "station", URLs: []string{remote}}); err != nil {
		t.Fatal(err)
	}
	service := &server{approvalToken: "approved", worktree: worktree, pushRemote: "station", statePath: filepath.Join(t.TempDir(), "state.json")}
	request := changeRequest{RequestID: "demo-link-1", Station: maitri, Workload: "observation-aggregate", Capability: "aggregation-schedule", Schedule: sixHourly, RequestedBy: "researcher", Role: "researcher"}
	if got := doChangeRequest(t, service, http.MethodPost, "/v1/change-requests", "", request).Code; got != http.StatusCreated {
		t.Fatalf("create: %d", got)
	}
	if got := doJSON(t, service, http.MethodPost, "/v1/change-requests/demo-link-1/approve", "approved", map[string]string{"approved_by": "lead"}).Code; got != http.StatusOK {
		t.Fatalf("approve: %d", got)
	}

	link := httptest.NewRequest(http.MethodPost, "/v1/link", bytes.NewBufferString(`{"up":true}`))
	link.Header.Set(approvalHeader, "approved")
	response := httptest.NewRecorder()
	service.setLink(response, link)
	if response.Code != http.StatusOK {
		t.Fatalf("restore link: %d %s", response.Code, response.Body.String())
	}
	read := doJSON(t, service, http.MethodGet, "/v1/change-requests/demo-link-1", "", nil)
	if read.Code != http.StatusOK || !strings.Contains(read.Body.String(), `"status":"delivered"`) {
		t.Fatalf("delivered lifecycle: %d %s", read.Code, read.Body.String())
	}
}

func TestConcurrentApprovedRequestsCreateOneRevision(t *testing.T) {
	worktree := newDesiredStateRepository(t, twelveHourly)
	server := &server{approvalToken: "approved", worktree: worktree, statePath: filepath.Join(t.TempDir(), "state.json")}
	request := scheduleRequest{RequestID: "sih-44", Station: maitri, Schedule: sixHourly, ApprovedBy: "operator@example.invalid"}

	const requests = 8
	statuses := make(chan int, requests)
	var group sync.WaitGroup
	for range requests {
		group.Add(1)
		go func() {
			defer group.Done()
			statuses <- doRequest(t, server, "approved", request).Code
		}()
	}
	group.Wait()
	close(statuses)

	created := 0
	for status := range statuses {
		switch status {
		case http.StatusCreated:
			created++
		case http.StatusOK:
		default:
			t.Fatalf("concurrent request status = %d", status)
		}
	}
	if created != 1 {
		t.Fatalf("created revisions = %d, want 1", created)
	}
}

func doRequest(t *testing.T, server *server, token string, value scheduleRequest) *httptest.ResponseRecorder {
	t.Helper()
	body, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, "/v1/approved-schedule-changes", bytes.NewReader(body))
	req.Header.Set(approvalHeader, token)
	response := httptest.NewRecorder()
	server.createScheduleChange(response, req)
	return response
}

func doChangeRequest(t *testing.T, server *server, method, path, token string, value changeRequest) *httptest.ResponseRecorder {
	t.Helper()
	return doJSON(t, server, method, path, token, value)
}

func doJSON(t *testing.T, server *server, method, path, token string, value any) *httptest.ResponseRecorder {
	t.Helper()
	var body *bytes.Reader
	if value == nil {
		body = bytes.NewReader(nil)
	} else {
		encoded, err := json.Marshal(value)
		if err != nil {
			t.Fatal(err)
		}
		body = bytes.NewReader(encoded)
	}
	req := httptest.NewRequest(method, path, body)
	if token != "" {
		req.Header.Set(approvalHeader, token)
	}
	response := httptest.NewRecorder()
	switch {
	case method == http.MethodPost && path == "/v1/change-requests":
		server.createChangeRequest(response, req)
	case method == http.MethodPost:
		server.decideChangeRequest(response, req)
	case method == http.MethodGet && path == "/v1/change-requests":
		server.listChangeRequests(response, req)
	default:
		server.getChangeRequest(response, req)
	}
	return response
}

func newDesiredStateRepository(t *testing.T, schedule string) string {
	t.Helper()
	root := t.TempDir()
	patchPath := filepath.Join(root, schedulePatchPath)
	if err := os.MkdirAll(filepath.Dir(patchPath), 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(patchPath, []byte(schedulePatch(schedule)), 0o640); err != nil {
		t.Fatal(err)
	}
	repo, err := git.PlainInit(root, false)
	if err != nil {
		t.Fatal(err)
	}
	worktree, err := repo.Worktree()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := worktree.Add(schedulePatchPath); err != nil {
		t.Fatal(err)
	}
	if _, err := worktree.Commit("baseline", &git.CommitOptions{Author: &object.Signature{Name: "test", Email: "test@example.invalid"}}); err != nil {
		t.Fatal(err)
	}
	return root
}

func TestGatewayHoldsReleasesAndRecoversAfterRestart(t *testing.T) {
	worktree := newDesiredStateRepository(t, twelveHourly)
	remote := newBareRemote(t)
	repo, err := git.PlainOpen(worktree)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.CreateRemote(&config.RemoteConfig{Name: "station", URLs: []string{remote}}); err != nil {
		t.Fatal(err)
	}
	statePath := filepath.Join(t.TempDir(), "gateway.json")
	service := &server{approvalToken: "approved", worktree: worktree, pushRemote: "station", statePath: statePath}
	request := scheduleRequest{RequestID: "outage-1", Station: maitri, Schedule: sixHourly, ApprovedBy: "operator"}
	if got := doRequest(t, service, "approved", request).Code; got != http.StatusCreated {
		t.Fatalf("approval: %d", got)
	}
	if service.state.Pending == "" || service.state.Delivered != "" {
		t.Fatalf("outage state: %+v", service.state)
	}
	remoteRepo, err := git.PlainOpen(remote)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := remoteRepo.Reference("refs/heads/master", true); err == nil {
		t.Fatal("remote advanced during outage")
	}
	restarted := &server{approvalToken: "approved", worktree: worktree, pushRemote: "station", statePath: statePath}
	if err := restarted.loadState(); err != nil {
		t.Fatal(err)
	}
	if restarted.state.Pending != service.state.Pending {
		t.Fatal("pending revision lost on restart")
	}
	body := bytes.NewBufferString(`{"up":true}`)
	toggle := httptest.NewRequest(http.MethodPost, "/v1/link", body)
	toggle.Header.Set(approvalHeader, "approved")
	response := httptest.NewRecorder()
	restarted.setLink(response, toggle)
	if response.Code != http.StatusOK {
		t.Fatalf("restore: %d %s", response.Code, response.Body.String())
	}
	if restarted.state.Pending != "" || restarted.state.Delivered == "" {
		t.Fatalf("delivery state: %+v", restarted.state)
	}
	remoteHead, err := remoteRepo.Reference("refs/heads/master", true)
	if err != nil {
		t.Fatal(err)
	}
	if remoteHead.Hash().String() != restarted.state.Delivered {
		t.Fatal("remote revision mismatch")
	}
	duplicate := doRequest(t, restarted, "approved", request)
	if duplicate.Code != http.StatusOK {
		t.Fatalf("duplicate: %d", duplicate.Code)
	}
	restarted.deliverLocked()
	if restarted.state.Attempts != 1 {
		t.Fatalf("duplicate delivered twice: %+v", restarted.state)
	}
}

func TestGatewayRetainsFailedDeliveryForRetry(t *testing.T) {
	worktree := newDesiredStateRepository(t, twelveHourly)
	statePath := filepath.Join(t.TempDir(), "gateway.json")
	service := &server{approvalToken: "approved", worktree: worktree, pushRemote: "missing", statePath: statePath, state: gatewayState{LinkUp: true}}
	request := scheduleRequest{RequestID: "retry-1", Station: maitri, Schedule: sixHourly, ApprovedBy: "operator"}
	if got := doRequest(t, service, "approved", request).Code; got != http.StatusCreated {
		t.Fatalf("approval: %d", got)
	}
	if service.state.Pending == "" || service.state.Attempts != 1 || service.state.LastError == "" {
		t.Fatalf("retry state: %+v", service.state)
	}
	restarted := &server{worktree: worktree, pushRemote: "missing", statePath: statePath}
	if err := restarted.loadState(); err != nil {
		t.Fatal(err)
	}
	restarted.deliverLocked()
	if restarted.state.Attempts != 2 || restarted.state.Pending == "" {
		t.Fatalf("retry after restart: %+v", restarted.state)
	}
}

func TestMaitriKustomizeRendersCompleteCronJob(t *testing.T) {
	output, err := exec.Command("kubectl", "kustomize", "../../gitops/maitri").CombinedOutput()
	if err != nil {
		t.Fatalf("kubectl kustomize: %v: %s", err, output)
	}
	rendered := string(output)
	for _, expected := range []string{"kind: CronJob", "name: observation-aggregate", "schedule: 0 */12 * * *", "concurrencyPolicy: Forbid", "timeZone: Etc/UTC", "jobTemplate:"} {
		if !strings.Contains(rendered, expected) {
			t.Fatalf("missing %q in render", expected)
		}
	}
}

func TestMaitriPolicyRequiresTheDedicatedFluxIdentity(t *testing.T) {
	policy, err := os.ReadFile("../flux/maitri/bootstrap.yaml")
	if err != nil {
		t.Fatal(err)
	}
	const identity = "system:serviceaccount:flux-system:maitri-flux-reconciler"
	if !strings.Contains(string(policy), identity) {
		t.Fatalf("station policy does not require dedicated Flux identity %q", identity)
	}
}
