package main

import (
	"bytes"
	"compress/gzip"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"
)

func gunzipAll(t *testing.T, b []byte) []byte {
	t.Helper()
	zr, err := gzip.NewReader(bytes.NewReader(b))
	if err != nil {
		t.Fatalf("not gzip: %v", err)
	}
	out, err := io.ReadAll(zr)
	if err != nil {
		t.Fatalf("broken gzip: %v", err)
	}
	return out
}

func TestTCPingHistoryIsGzippedWhenAccepted(t *testing.T) {
	store := newTestStore(t)
	now := time.Now().UTC()
	for i := 0; i < 300; i++ {
		lat := float64(10 + i%7)
		for _, target := range []string{"1.1.1.1:53", "github.com:443"} {
			if err := store.SaveTCPingResult(TCPingResult{ClientID: "a", Target: target, Latency: &lat, Timestamp: now.Add(-time.Duration(i) * time.Minute)}); err != nil {
				t.Fatal(err)
			}
		}
	}
	get := func(query, enc string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, "/api/tcping/history?"+query, nil)
		if enc != "" {
			req.Header.Set("Accept-Encoding", enc)
		}
		rr := httptest.NewRecorder()
		handleGetTCPingHistory(store, rr, req)
		return rr
	}
	for _, query := range []string{"client_id=a", "client_id=a&target=1.1.1.1:53"} {
		plain := get(query, "")
		if plain.Code != http.StatusOK || plain.Header().Get("Content-Encoding") != "" || !strings.HasSuffix(plain.Body.String(), "}\n") {
			t.Fatalf("%s without gzip: %d %q", query, plain.Code, plain.Header().Get("Content-Encoding"))
		}
		// The second request with a target is served from the response cache.
		for round := 0; round < 2; round++ {
			gz := get(query, "gzip, deflate, br")
			if gz.Header().Get("Content-Encoding") != "gzip" || !strings.Contains(gz.Header().Get("Vary"), "Accept-Encoding") {
				t.Fatalf("%s round %d: not compressed: %v", query, round, gz.Header())
			}
			if cl := gz.Header().Get("Content-Length"); cl != strconv.Itoa(gz.Body.Len()) {
				t.Fatalf("%s: Content-Length %s for %d bytes", query, cl, gz.Body.Len())
			}
			if gz.Body.Len()*5 > plain.Body.Len() {
				t.Fatalf("%s: %d bytes compressed from %d", query, gz.Body.Len(), plain.Body.Len())
			}
			if got := gunzipAll(t, gz.Body.Bytes()); !bytes.Equal(got, plain.Body.Bytes()) {
				t.Fatalf("%s round %d: decompressed body differs from the plain one", query, round)
			}
		}
		if refused := get(query, "gzip;q=0"); refused.Header().Get("Content-Encoding") != "" {
			t.Fatalf("%s: compressed although gzip;q=0", query)
		}
	}
}

func TestListMetricsCompressesOnlyResponsesWithoutSecrets(t *testing.T) {
	store := newTestStore(t)
	hw := &HardwareInfo{CollectedAt: time.Now().UTC().Add(-time.Minute)}
	for i := 0; i < 12; i++ {
		hw.Disks = append(hw.Disks, DiskHardware{Device: fmt.Sprintf("sd%c", 'a'+i), Model: "WDC WUH721818ALE6L4", Serial: fmt.Sprintf("SERIAL-%d", i)})
	}
	for i := 0; i < 6; i++ {
		m := SystemMetric{ID: fmt.Sprintf("h%d", i), Name: fmt.Sprintf("Host %d", i), Secret: "fleet-secret", IPv4: "203.0.113.5", Hardware: hw, UpdatedAt: time.Now().UTC()}
		if err := store.Upsert(m); err != nil {
			t.Fatal(err)
		}
	}
	authTokensMu.Lock()
	authTokens["test-admin-token"] = time.Now().Add(time.Hour)
	authTokensMu.Unlock()
	t.Cleanup(func() {
		authTokensMu.Lock()
		delete(authTokens, "test-admin-token")
		authTokensMu.Unlock()
	})
	get := func(target string, admin bool) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, target, nil)
		req.Header.Set("Accept-Encoding", "gzip")
		if admin {
			req.Header.Set("Authorization", "Bearer test-admin-token")
		}
		rr := httptest.NewRecorder()
		handleListMetrics(store, rr, req)
		return rr
	}

	adminList := get("/api/metrics", true)
	if adminList.Code != http.StatusOK || adminList.Header().Get("Content-Encoding") != "" || !strings.Contains(adminList.Body.String(), "fleet-secret") {
		t.Fatalf("the admin's list (agent secrets) must go out uncompressed: %d %v", adminList.Code, adminList.Header())
	}
	for _, c := range []struct {
		target string
		admin  bool
	}{
		{"/api/metrics", false},
		{"/api/metrics?view=hardware", false},
		{"/api/metrics?view=hardware", true},
		{"/api/metrics?id=h1", true},
	} {
		rr := get(c.target, c.admin)
		if rr.Code != http.StatusOK || rr.Header().Get("Content-Encoding") != "gzip" {
			t.Fatalf("%s (admin %v): %d, not compressed: %v", c.target, c.admin, rr.Code, rr.Header())
		}
		if body := string(gunzipAll(t, rr.Body.Bytes())); strings.Contains(body, "fleet-secret") || !strings.Contains(body, `"h1"`) {
			t.Fatalf("%s (admin %v): unexpected body %.200s", c.target, c.admin, body)
		}
	}
}

func TestJSONBodyGoesOutPlainWhenSmallOrAllCompressorsBusy(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Accept-Encoding", "gzip")

	small := []byte(`{"ok":true}` + "\n")
	rr := httptest.NewRecorder()
	writeJSONBody(rr, req, http.StatusOK, small)
	if rr.Header().Get("Content-Encoding") != "" || rr.Header().Get("Vary") != "" || !bytes.Equal(rr.Body.Bytes(), small) {
		t.Fatalf("a small body must go out as it is: %v %q", rr.Header(), rr.Body.String())
	}

	big := append(bytes.Repeat([]byte(`{"latency":12.5},`), 200), '\n')
	for i := 0; i < cap(jsonGzipSlots); i++ {
		jsonGzipSlots <- struct{}{}
	}
	rr = httptest.NewRecorder()
	writeJSONBody(rr, req, http.StatusOK, big)
	for i := 0; i < cap(jsonGzipSlots); i++ {
		<-jsonGzipSlots
	}
	if rr.Header().Get("Content-Encoding") != "" || !bytes.Equal(rr.Body.Bytes(), big) || rr.Header().Get("Content-Length") != strconv.Itoa(len(big)) {
		t.Fatalf("with every compressor busy the body must go out plain, without waiting: %v", rr.Header())
	}

	rr = httptest.NewRecorder()
	writeJSONBody(rr, req, http.StatusOK, big)
	if rr.Header().Get("Content-Encoding") != "gzip" || !bytes.Equal(gunzipAll(t, rr.Body.Bytes()), big) {
		t.Fatalf("once a compressor is free the body is compressed again: %v", rr.Header())
	}
}
