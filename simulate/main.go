package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"hash/fnv"
	"log"
	"math"
	"math/rand/v2"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

type observation struct {
	ID         string             `json:"id"`
	Station    string             `json:"station"`
	Source     string             `json:"source"`
	ObservedAt time.Time          `json:"observed_at"`
	IngestedAt time.Time          `json:"ingested_at,omitempty"`
	Sequence   int64              `json:"sequence"`
	Synthetic  bool               `json:"synthetic"`
	Schema     string             `json:"schema_version"`
	Quality    string             `json:"quality"`
	Values     map[string]float64 `json:"values"`
	Units      map[string]string  `json:"units"`
}

type diskStore struct {
	mu            sync.RWMutex
	observations  []observation
	dataPath      string
	aggregatePath string
}

func main() {
	if len(os.Args) != 2 {
		log.Fatal("usage: simulator <store|producer|aggregate|diagnostic>")
	}
	var err error
	switch os.Args[1] {
	case "store":
		err = runStore()
	case "producer":
		err = runProducer()
	case "aggregate":
		err = postAction("/aggregate")
	case "diagnostic":
		err = runDiagnostic()
	default:
		err = fmt.Errorf("unknown command %q", os.Args[1])
	}
	if err != nil {
		log.Fatal(err)
	}
}

func runStore() error {
	dataDir := env("DATA_DIR", "/data")
	if err := os.MkdirAll(dataDir, 0o750); err != nil {
		return err
	}
	s := &diskStore{
		dataPath:      filepath.Join(dataDir, "observations.jsonl"),
		aggregatePath: filepath.Join(dataDir, "aggregates.jsonl"),
	}
	if err := s.load(); err != nil {
		return err
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) })
	mux.HandleFunc("GET /readyz", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) })
	mux.HandleFunc("POST /observations", s.ingest)
	mux.HandleFunc("GET /latest", s.latest)
	mux.HandleFunc("POST /aggregate", s.aggregate)
	server := &http.Server{Addr: ":8080", Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	log.Printf("store listening on %s with %d persisted observations", server.Addr, len(s.observations))
	return server.ListenAndServe()
}

func (s *diskStore) load() error {
	f, err := os.Open(s.dataPath)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	defer f.Close()
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		var item observation
		if err := json.Unmarshal(scanner.Bytes(), &item); err != nil {
			return fmt.Errorf("read persisted observation: %w", err)
		}
		s.observations = append(s.observations, item)
	}
	return scanner.Err()
}

func (s *diskStore) ingest(w http.ResponseWriter, r *http.Request) {
	var item observation
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&item); err != nil {
		http.Error(w, "invalid observation", http.StatusBadRequest)
		return
	}
	if item.ID == "" || item.Station == "" || item.Source == "" || item.ObservedAt.IsZero() || !item.Synthetic {
		http.Error(w, "missing required synthetic observation fields", http.StatusBadRequest)
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, existing := range s.observations {
		if existing.ID == item.ID {
			w.WriteHeader(http.StatusNoContent)
			return
		}
	}
	item.IngestedAt = time.Now().UTC()
	encoded, _ := json.Marshal(item)
	f, err := os.OpenFile(s.dataPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o640)
	if err != nil {
		http.Error(w, "persist failed", http.StatusInternalServerError)
		return
	}
	_, writeErr := fmt.Fprintln(f, string(encoded))
	closeErr := f.Close()
	if writeErr != nil || closeErr != nil {
		http.Error(w, "persist failed", http.StatusInternalServerError)
		return
	}
	s.observations = append(s.observations, item)
	w.WriteHeader(http.StatusCreated)
}

func (s *diskStore) latest(w http.ResponseWriter, r *http.Request) {
	source := r.URL.Query().Get("source")
	s.mu.RLock()
	defer s.mu.RUnlock()
	for i := len(s.observations) - 1; i >= 0; i-- {
		if source == "" || s.observations[i].Source == source {
			writeJSON(w, s.observations[i])
			return
		}
	}
	http.Error(w, "no observations", http.StatusNotFound)
}

func (s *diskStore) aggregate(w http.ResponseWriter, _ *http.Request) {
	s.mu.RLock()
	items := append([]observation(nil), s.observations...)
	s.mu.RUnlock()
	if len(items) == 0 {
		http.Error(w, "no observations", http.StatusConflict)
		return
	}
	type stat struct {
		Min, Max, Sum float64
		Count         int
	}
	stats := map[string]stat{}
	for _, item := range items {
		for name, value := range item.Values {
			v, ok := stats[name]
			if !ok {
				v.Min, v.Max = value, value
			}
			v.Min = math.Min(v.Min, value)
			v.Max = math.Max(v.Max, value)
			v.Sum += value
			v.Count++
			stats[name] = v
		}
	}
	result := map[string]any{"generated_at": time.Now().UTC(), "synthetic": true, "sample_count": len(items), "metrics": map[string]any{}}
	metrics := result["metrics"].(map[string]any)
	for name, v := range stats {
		metrics[name] = map[string]any{"minimum": v.Min, "average": v.Sum / float64(v.Count), "maximum": v.Max, "count": v.Count}
	}
	encoded, _ := json.Marshal(result)
	f, err := os.OpenFile(s.aggregatePath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o640)
	if err != nil {
		http.Error(w, "persist failed", http.StatusInternalServerError)
		return
	}
	_, writeErr := fmt.Fprintln(f, string(encoded))
	closeErr := f.Close()
	if writeErr != nil || closeErr != nil {
		http.Error(w, "persist failed", http.StatusInternalServerError)
		return
	}
	writeJSON(w, result)
}

func runProducer() error {
	station, source := strings.ToLower(env("STATION", "maitri")), strings.ToLower(env("SOURCE", "aws"))
	interval, err := time.ParseDuration(env("INTERVAL", "1h"))
	if err != nil {
		return fmt.Errorf("INTERVAL: %w", err)
	}
	endpoint := strings.TrimRight(env("STORE_URL", "http://localhost:8080"), "/")
	seed := hash(station + ":" + source + ":" + env("SEED", "simulator-v1"))
	values, sequence := initialState(endpoint, source, station)
	client := &http.Client{Timeout: 10 * time.Second}
	for {
		observedAt := time.Now().UTC().Truncate(interval)
		sequence++
		values = nextValues(values, station, source, seed+uint64(sequence))
		item := makeObservation(station, source, observedAt, sequence, values)
		for {
			body, _ := json.Marshal(item)
			resp, err := client.Post(endpoint+"/observations", "application/json", bytes.NewReader(body))
			if err == nil && resp.StatusCode < 300 {
				resp.Body.Close()
				log.Printf("emitted %s", item.ID)
				break
			}
			if err != nil {
				log.Printf("store unavailable; retrying %s: %v", item.ID, err)
			} else {
				resp.Body.Close()
				log.Printf("store rejected %s with %s; retrying", item.ID, resp.Status)
			}
			time.Sleep(5 * time.Second)
		}
		time.Sleep(interval)
	}
}

func initialState(endpoint, source, station string) (map[string]float64, int64) {
	resp, err := (&http.Client{Timeout: 5 * time.Second}).Get(endpoint + "/latest?source=" + source)
	if err == nil && resp.StatusCode == http.StatusOK {
		defer resp.Body.Close()
		var item observation
		if json.NewDecoder(resp.Body).Decode(&item) == nil {
			return item.Values, item.Sequence
		}
	}
	if resp != nil {
		resp.Body.Close()
	}
	base := map[string]float64{"temperature_c": -20, "relative_humidity_pct": 55, "air_pressure_hpa": 960, "wind_speed_mps": 12, "wind_direction_deg": 180}
	if station == "maitri" {
		base["temperature_c"] = -15
		base["air_pressure_hpa"] = 985
	}
	if source == "parsivel" {
		return map[string]float64{"precipitation_rate_mmph": 0}, 0
	}
	return base, 0
}

func nextValues(previous map[string]float64, station, source string, seed uint64) map[string]float64 {
	r := rand.New(rand.NewPCG(seed, seed^0x9e3779b97f4a7c15))
	if source == "parsivel" {
		rate := clamp(previous["precipitation_rate_mmph"]+(r.Float64()-.62)*.8, 0, 12)
		return map[string]float64{"precipitation_rate_mmph": round(rate, 2)}
	}
	baselineTemp := -20.0
	if station == "maitri" {
		baselineTemp = -15
	}
	return map[string]float64{
		"temperature_c":         round(drift(previous["temperature_c"], baselineTemp, .7, r), 2),
		"relative_humidity_pct": round(clamp(drift(previous["relative_humidity_pct"], 55, 4, r), 5, 100), 2),
		"air_pressure_hpa":      round(clamp(drift(previous["air_pressure_hpa"], 970, 1.2, r), 900, 1030), 2),
		"wind_speed_mps":        round(clamp(drift(previous["wind_speed_mps"], 12, 2.5, r), 0, 55), 2),
		"wind_direction_deg":    round(math.Mod(previous["wind_direction_deg"]+(r.Float64()-.5)*30+360, 360), 1),
	}
}

func makeObservation(station, source string, at time.Time, sequence int64, values map[string]float64) observation {
	units := map[string]string{"temperature_c": "degC", "relative_humidity_pct": "percent", "air_pressure_hpa": "hPa", "wind_speed_mps": "m/s", "wind_direction_deg": "degree", "precipitation_rate_mmph": "mm/h"}
	return observation{ID: fmt.Sprintf("%s/%s/%s/v1", station, source, at.Format(time.RFC3339)), Station: station, Source: source, ObservedAt: at, Sequence: sequence, Synthetic: true, Schema: "v1", Quality: "synthetic", Values: values, Units: units}
}

func postAction(path string) error {
	endpoint := strings.TrimRight(env("STORE_URL", "http://localhost:8080"), "/")
	resp, err := (&http.Client{Timeout: 30 * time.Second}).Post(endpoint+path, "application/json", nil)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return fmt.Errorf("store returned %s", resp.Status)
	}
	return json.NewDecoder(resp.Body).Decode(&map[string]any{})
}

func runDiagnostic() error {
	endpoint := strings.TrimRight(env("STORE_URL", "http://localhost:8080"), "/")
	resp, err := (&http.Client{Timeout: 10 * time.Second}).Get(endpoint + "/latest")
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("latest observation check returned %s", resp.Status)
	}
	var item observation
	if err := json.NewDecoder(resp.Body).Decode(&item); err != nil {
		return err
	}
	if !item.Synthetic || time.Since(item.ObservedAt) > 2*time.Hour {
		return errors.New("latest synthetic observation is stale or invalid")
	}
	log.Printf("diagnostic passed: latest=%s source=%s observed_at=%s", item.ID, item.Source, item.ObservedAt.Format(time.RFC3339))
	return nil
}

func writeJSON(w http.ResponseWriter, value any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(value)
}
func env(name, fallback string) string {
	if v := os.Getenv(name); v != "" {
		return v
	}
	return fallback
}
func hash(value string) uint64               { h := fnv.New64a(); _, _ = h.Write([]byte(value)); return h.Sum64() }
func clamp(value, low, high float64) float64 { return math.Max(low, math.Min(high, value)) }
func drift(previous, baseline, amplitude float64, r *rand.Rand) float64 {
	return previous*.85 + baseline*.15 + (r.Float64()-.5)*amplitude
}
func round(value float64, places int) float64 {
	scale, _ := strconv.ParseFloat("1"+strings.Repeat("0", places), 64)
	return math.Round(value*scale) / scale
}
