package main

import (
	"bufio"
	"bytes"
	"compress/gzip"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestAcceptsGzip(t *testing.T) {
	cases := map[string]bool{
		"":                          false,
		"gzip":                      true,
		"gzip, deflate, br, zstd":   true,
		"br;q=1.0, GZIP;q=0.8":      true,
		"gzip;q=0":                  false,
		"gzip; q=0.000, identity":   false,
		"*":                         true,
		"identity;q=1, *;q=0":       false,
		"deflate, br":               false,
		"x-gzip-but-not-really, br": false,
	}
	for header, want := range cases {
		r := httptest.NewRequest(http.MethodGet, "/", nil)
		r.Header.Set("Accept-Encoding", header)
		if got := acceptsGzip(r); got != want {
			t.Errorf("acceptsGzip(%q) = %v, want %v", header, got, want)
		}
	}
}

func TestStreamSnapshotDropsHardwareAndSecret(t *testing.T) {
	at := time.Date(2026, 10, 24, 8, 30, 15, 123456789, time.UTC)
	ms := []SystemMetric{
		{ID: "ds", Name: "DS", Secret: "fleet-secret", IPv4: "203.0.113.5", Health: "ok",
			Hardware: &HardwareInfo{CollectedAt: at, Disks: []DiskHardware{{Device: "sda", Serial: "SERIAL-1"}}}},
		{ID: "vps", Name: "VPS", Secret: "fleet-secret"},
	}
	b, err := json.Marshal(streamSnapshot(ms))
	if err != nil {
		t.Fatal(err)
	}
	s := string(b)
	for _, banned := range []string{`"hardware"`, `"secret"`, "fleet-secret", "SERIAL-1"} {
		if strings.Contains(s, banned) {
			t.Fatalf("stream frame contains %s: %s", banned, s)
		}
	}
	var out []map[string]interface{}
	if err := json.Unmarshal(b, &out); err != nil {
		t.Fatal(err)
	}
	// The stamp must equal the snapshot's own collected_at, byte for byte, so
	// the dashboard can tell whether its cached copy is current.
	full, _ := json.Marshal(ms[0].Hardware)
	var hw map[string]interface{}
	_ = json.Unmarshal(full, &hw)
	if out[0]["hardware_at"] != hw["collected_at"] {
		t.Fatalf("hardware_at %v != collected_at %v", out[0]["hardware_at"], hw["collected_at"])
	}
	if _, ok := out[1]["hardware_at"]; ok {
		t.Fatalf("a host without hardware got hardware_at: %v", out[1])
	}
	if out[0]["ipv4"] != "203.0.113.5" || out[0]["health"] != "ok" {
		t.Fatalf("other fields must pass through unchanged: %v", out[0])
	}
}

func seedStreamStore(t *testing.T) *Store {
	t.Helper()
	store := newTestStore(t)
	hw := &HardwareInfo{CollectedAt: time.Now().UTC().Add(-time.Minute), Disks: []DiskHardware{{Device: "sda", Serial: "SERIAL-1"}}}
	for _, m := range []SystemMetric{
		{ID: "a", Name: "Alpha", Secret: "fleet-secret", IPv4: "203.0.113.5", Hardware: hw, UpdatedAt: time.Now().UTC()},
		{ID: "b", Name: "Beta", Secret: "fleet-secret", UpdatedAt: time.Now().UTC()},
	} {
		if err := store.Upsert(m); err != nil {
			t.Fatal(err)
		}
	}
	return store
}

func listMetrics(t *testing.T, store *Store, target string, admin bool) (int, []SystemMetric) {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, target, nil)
	if admin {
		req.Header.Set("Authorization", "Bearer test-admin-token")
	}
	rr := httptest.NewRecorder()
	handleListMetrics(store, rr, req)
	var out []SystemMetric
	if rr.Code == http.StatusOK {
		if err := json.Unmarshal(rr.Body.Bytes(), &out); err != nil {
			t.Fatalf("%s: %v", target, err)
		}
	}
	return rr.Code, out
}

func TestListMetricsSingleHostKeepsListRules(t *testing.T) {
	store := seedStreamStore(t)
	authTokensMu.Lock()
	authTokens["test-admin-token"] = time.Now().Add(time.Hour)
	authTokensMu.Unlock()
	t.Cleanup(func() {
		authTokensMu.Lock()
		delete(authTokens, "test-admin-token")
		authTokensMu.Unlock()
	})

	code, pub := listMetrics(t, store, "/api/metrics?id=a", false)
	if code != http.StatusOK || len(pub) != 1 || pub[0].ID != "a" || pub[0].Hardware == nil {
		t.Fatalf("public ?id=a: %d %+v", code, pub)
	}
	if pub[0].IPv4 != "" || pub[0].Secret != "" || pub[0].Hardware.Disks[0].Serial != "" {
		t.Fatalf("public ?id=a leaked privileged fields: %+v", pub[0])
	}
	code, adm := listMetrics(t, store, "/api/metrics?id=a", true)
	if code != http.StatusOK || len(adm) != 1 || adm[0].IPv4 == "" || adm[0].Hardware.Disks[0].Serial != "SERIAL-1" {
		t.Fatalf("admin ?id=a: %d %+v", code, adm)
	}
	if adm[0].Secret != "" {
		t.Fatalf("?id= must not carry the agent secret")
	}
	if code, none := listMetrics(t, store, "/api/metrics?id=missing", true); code != http.StatusOK || len(none) != 0 {
		t.Fatalf("unknown id: %d %+v", code, none)
	}
	if code, all := listMetrics(t, store, "/api/metrics", true); code != http.StatusOK || len(all) != 2 || all[0].Secret == "" {
		t.Fatalf("the full admin list is unchanged (secret included): %d %d", code, len(all))
	}

	// Privacy mode: the single-host form is refused exactly like the list.
	if err := store.SavePrivacyConfig(&PrivacyConfig{Enabled: true, ShareToken: "share-1", TokenExpires: time.Now().Add(time.Hour)}); err != nil {
		t.Fatal(err)
	}
	if code, _ := listMetrics(t, store, "/api/metrics?id=a", false); code != http.StatusUnauthorized {
		t.Fatalf("privacy mode, anonymous ?id=a: %d", code)
	}
	if code, got := listMetrics(t, store, "/api/metrics?id=a&token=share-1", false); code != http.StatusOK || len(got) != 1 || got[0].IPv4 != "" {
		t.Fatalf("privacy mode, share token ?id=a: %d %+v", code, got)
	}
	if code, _ := listMetrics(t, store, "/api/metrics?id=a&token=wrong", false); code != http.StatusUnauthorized {
		t.Fatalf("privacy mode, wrong token: %d", code)
	}
}

// nextUpdate returns the data line of the next "event: update" frame.
func nextUpdate(r *bufio.Reader) (string, error) {
	isUpdate := false
	for {
		line, err := r.ReadString('\n')
		if err != nil {
			return "", err
		}
		line = strings.TrimRight(line, "\n")
		switch {
		case line == "event: update":
			isUpdate = true
		case isUpdate && strings.HasPrefix(line, "data: "):
			return strings.TrimPrefix(line, "data: "), nil
		case line == "":
			isUpdate = false
		}
	}
}

func TestSSEStreamIsCompressedPerFrameAndCarriesNoHardware(t *testing.T) {
	store := seedStreamStore(t)
	broker := NewSSEBroker()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { handleSSE(store, broker, w, r) }))
	t.Cleanup(srv.Close)

	for _, compressed := range []bool{true, false} {
		req, _ := http.NewRequest(http.MethodGet, srv.URL+"/api/events", nil)
		req.Header.Set("Accept", "text/event-stream")
		if compressed {
			req.Header.Set("Accept-Encoding", "gzip") // set by hand: the client then leaves the body compressed
		} else {
			req.Header.Set("Accept-Encoding", "identity")
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		if got := resp.Header.Get("Content-Encoding"); (got == "gzip") != compressed {
			t.Fatalf("compressed=%v: Content-Encoding %q", compressed, got)
		}
		if !strings.Contains(resp.Header.Get("Cache-Control"), "no-transform") {
			t.Fatalf("SSE Cache-Control lacks no-transform: %q", resp.Header.Get("Cache-Control"))
		}
		var body io.Reader = resp.Body
		if compressed {
			zr, err := gzip.NewReader(resp.Body)
			if err != nil {
				t.Fatalf("gzip header: %v", err)
			}
			body = zr
		}
		lines := bufio.NewReader(body)

		frame, err := nextUpdate(lines) // initial snapshot
		if err != nil {
			t.Fatalf("compressed=%v: initial frame: %v", compressed, err)
		}
		for _, banned := range []string{`"hardware":`, `"secret"`, "fleet-secret", "SERIAL-1"} {
			if strings.Contains(frame, banned) {
				t.Fatalf("initial frame carries %s", banned)
			}
		}
		if !strings.Contains(frame, `"hardware_at"`) {
			t.Fatalf("initial frame lacks hardware_at: %s", frame)
		}

		// A broadcast must arrive at once, not sit in the compressor.
		got := make(chan string, 1)
		go func() {
			f, err := nextUpdate(lines)
			if err != nil {
				f = "error: " + err.Error()
			}
			got <- f
		}()
		time.Sleep(50 * time.Millisecond)
		broadcastMetricsSnapshot(store, nil, broker)
		select {
		case f := <-got:
			if strings.Contains(f, "fleet-secret") || !strings.Contains(f, `"Beta"`) {
				t.Fatalf("broadcast frame: %s", f)
			}
		case <-time.After(3 * time.Second):
			t.Fatalf("compressed=%v: broadcast frame did not arrive within 3 s", compressed)
		}
		resp.Body.Close()
	}
}

func TestSSEGzipStreamIsValidGzipWhenClosed(t *testing.T) {
	// Many streams at once share the bounded compressor pool.
	var wg sync.WaitGroup
	errs := make(chan error, 32)
	for n := 0; n < 32; n++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			var out bytes.Buffer
			g := &sseGzip{}
			var want strings.Builder
			for i := 0; i < 20; i++ {
				parts := []string{"event: update\ndata: ", fmt.Sprintf(`{"stream":%d,"frame":%d,"pad":%q}`, n, i, strings.Repeat("x", i*97)), "\n\n"}
				if err := g.write(&out, parts...); err != nil {
					errs <- err
					return
				}
				want.WriteString(strings.Join(parts, ""))
			}
			if err := g.close(&out); err != nil {
				errs <- err
				return
			}
			zr, err := gzip.NewReader(&out)
			if err != nil {
				errs <- err
				return
			}
			got, err := io.ReadAll(zr) // verifies the CRC-32 and length trailer
			if err != nil {
				errs <- fmt.Errorf("stream %d: %v", n, err)
				return
			}
			if string(got) != want.String() {
				errs <- fmt.Errorf("stream %d: decoded text differs", n)
			}
		}(n)
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Fatal(err)
	}
	if (&sseGzip{}).close(io.Discard) != nil {
		t.Fatal("closing a stream that never wrote must be a no-op")
	}
}

func TestListMetricsHardwareViewKeepsListRules(t *testing.T) {
	store := seedStreamStore(t)
	authTokensMu.Lock()
	authTokens["test-admin-token"] = time.Now().Add(time.Hour)
	authTokensMu.Unlock()
	t.Cleanup(func() {
		authTokensMu.Lock()
		delete(authTokens, "test-admin-token")
		authTokensMu.Unlock()
	})
	get := func(target string, admin bool) (int, string) {
		req := httptest.NewRequest(http.MethodGet, target, nil)
		if admin {
			req.Header.Set("Authorization", "Bearer test-admin-token")
		}
		rr := httptest.NewRecorder()
		handleListMetrics(store, rr, req)
		return rr.Code, rr.Body.String()
	}

	code, body := get("/api/metrics?view=hardware", false)
	var inv []map[string]json.RawMessage
	if code != http.StatusOK || json.Unmarshal([]byte(body), &inv) != nil || len(inv) != 1 {
		t.Fatalf("public hardware view: %d %s", code, body)
	}
	if len(inv[0]) != 2 || string(inv[0]["id"]) != `"a"` || inv[0]["hardware"] == nil {
		t.Fatalf("hardware view must hold only id + hardware: %s", body)
	}
	for _, banned := range []string{"fleet-secret", "203.0.113.5", "SERIAL-1", `"name"`} {
		if strings.Contains(body, banned) {
			t.Fatalf("public hardware view leaks %s: %s", banned, body)
		}
	}
	if _, body := get("/api/metrics?view=hardware", true); !strings.Contains(body, "SERIAL-1") || strings.Contains(body, "fleet-secret") || strings.Contains(body, "203.0.113.5") {
		t.Fatalf("admin hardware view: serials yes, secret and addresses no: %s", body)
	}

	if err := store.SavePrivacyConfig(&PrivacyConfig{Enabled: true, ShareToken: "share-1", TokenExpires: time.Now().Add(time.Hour)}); err != nil {
		t.Fatal(err)
	}
	if code, _ := get("/api/metrics?view=hardware", false); code != http.StatusUnauthorized {
		t.Fatalf("privacy mode, anonymous hardware view: %d", code)
	}
	if code, body := get("/api/metrics?view=hardware&token=share-1", false); code != http.StatusOK || strings.Contains(body, "SERIAL-1") {
		t.Fatalf("privacy mode, share token: %d %s", code, body)
	}
}
