package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestObservationHistoryUsesObservedTimeAndSource(t *testing.T) {
	at := time.Date(2026, 9, 24, 12, 0, 0, 0, time.UTC)
	s := &diskStore{observations: []observation{
		{ID: "aws-new", Source: "aws", ObservedAt: at},
		{ID: "other", Source: "parsivel", ObservedAt: at.Add(time.Minute)},
		{ID: "aws-old", Source: "aws", ObservedAt: at.Add(-2 * time.Hour)},
		{ID: "aws-mid", Source: "aws", ObservedAt: at.Add(-time.Hour)},
	}}
	response := httptest.NewRecorder()
	s.listObservations(response, httptest.NewRequest(http.MethodGet, "/observations?source=aws&limit=2", nil))
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d", response.Code)
	}
	var items []observation
	if err := json.Unmarshal(response.Body.Bytes(), &items); err != nil {
		t.Fatal(err)
	}
	if len(items) != 2 || items[0].ID != "aws-mid" || items[1].ID != "aws-new" {
		t.Fatalf("unexpected history: %+v", items)
	}

	response = httptest.NewRecorder()
	s.latest(response, httptest.NewRequest(http.MethodGet, "/latest?source=aws", nil))
	var latest observation
	if err := json.Unmarshal(response.Body.Bytes(), &latest); err != nil {
		t.Fatal(err)
	}
	if latest.ID != "aws-new" {
		t.Fatalf("latest = %s", latest.ID)
	}
}

func TestBootstrapWeatherHistory(t *testing.T) {
	end := time.Date(2026, 9, 24, 12, 0, 0, 0, time.UTC)
	initial := map[string]float64{"temperature_c": -15, "relative_humidity_pct": 55, "air_pressure_hpa": 970, "wind_speed_mps": 12, "wind_direction_deg": 180}
	items := bootstrapObservations("maitri", "aws", end, time.Hour, 42, initial, 24, 1)
	if len(items) != 24 || !items[0].ObservedAt.Equal(end.Add(-24*time.Hour)) || !items[23].ObservedAt.Equal(end.Add(-time.Hour)) {
		t.Fatalf("unexpected bootstrap timeline: %+v", items)
	}
	for _, item := range items {
		for _, key := range []string{"temperature_c", "relative_humidity_pct", "air_pressure_hpa", "wind_speed_mps"} {
			if _, ok := item.Values[key]; !ok {
				t.Fatalf("%s missing %s", item.ID, key)
			}
		}
	}
}
