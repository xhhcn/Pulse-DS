package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

func resetTrustedProxiesForTest(t *testing.T, env string) {
	t.Helper()
	t.Setenv("TRUSTED_PROXIES", env)
	trustedProxyOnce = sync.Once{}
	trustedProxyNets = nil
}

func TestStaticFilePathFromURL(t *testing.T) {
	valid := map[string]string{
		"/":                           "index.html",
		"/admin":                      "admin",
		"/admin/":                     "admin",
		"/_astro/hoisted.ABC123.js":   "_astro/hoisted.ABC123.js",
		"/dashboard../data/config.js": "dashboard../data/config.js",
	}
	for input, want := range valid {
		got, ok := staticFilePathFromURL(input)
		if !ok || got != want {
			t.Fatalf("staticFilePathFromURL(%q) = %q, %v; want %q, true", input, got, ok, want)
		}
	}

	invalid := []string{
		"/../server/main.go",
		"/_astro/../index.html",
		"/./admin",
		"/admin//index.html",
		`/admin\index.html`,
	}
	for _, input := range invalid {
		if got, ok := staticFilePathFromURL(input); ok {
			t.Fatalf("staticFilePathFromURL(%q) = %q, true; want invalid", input, got)
		}
	}
}

func TestGetClientIPIgnoresForwardedHeadersFromUntrustedPeer(t *testing.T) {
	resetTrustedProxiesForTest(t, "")
	req := httptest.NewRequest("GET", "/", nil)
	req.RemoteAddr = "198.51.100.10:4321"
	req.Header.Set("X-Forwarded-For", "203.0.113.99")
	req.Header.Set("X-Real-IP", "203.0.113.98")

	if got, want := getClientIP(req), "198.51.100.10"; got != want {
		t.Fatalf("getClientIP() = %q, want %q", got, want)
	}
}

func TestGetClientIPTrustsLoopbackProxy(t *testing.T) {
	resetTrustedProxiesForTest(t, "")
	req := httptest.NewRequest("GET", "/", nil)
	req.RemoteAddr = "127.0.0.1:4321"
	req.Header.Set("X-Forwarded-For", "203.0.113.99, 10.0.0.20")

	// The right-most hop is what the trusted proxy actually saw; the
	// left-most entry could have been supplied by the client itself.
	if got, want := getClientIP(req), "10.0.0.20"; got != want {
		t.Fatalf("getClientIP() = %q, want %q", got, want)
	}
}

func TestGetClientIPIgnoresClientSuppliedForwardedPrefixBehindCDN(t *testing.T) {
	// Cloudflare (trusted) appends the connecting IP to whatever
	// X-Forwarded-For the client sent. The spoofed prefix must not win.
	resetTrustedProxiesForTest(t, "173.245.48.0/20")
	req := httptest.NewRequest("GET", "/", nil)
	req.RemoteAddr = "173.245.48.7:443"
	req.Header.Set("X-Forwarded-For", "1.2.3.4, 198.51.100.9")

	if got, want := getClientIP(req), "198.51.100.9"; got != want {
		t.Fatalf("getClientIP() = %q, want %q", got, want)
	}
}

func TestGetClientIPSkipsTrustedHopsInsideTheChain(t *testing.T) {
	// nginx (loopback) behind Cloudflare: chain is "client, cf-edge" and
	// the peer is nginx; the trusted edge entry is skipped.
	resetTrustedProxiesForTest(t, "173.245.48.0/20")
	req := httptest.NewRequest("GET", "/", nil)
	req.RemoteAddr = "127.0.0.1:4321"
	req.Header.Set("X-Forwarded-For", "203.0.113.99, 173.245.48.7")

	if got, want := getClientIP(req), "203.0.113.99"; got != want {
		t.Fatalf("getClientIP() = %q, want %q", got, want)
	}
}

func TestGetClientIPTrustsConfiguredProxyCIDR(t *testing.T) {
	resetTrustedProxiesForTest(t, "10.10.0.0/16")
	req := httptest.NewRequest("GET", "/", nil)
	req.RemoteAddr = "10.10.5.20:4321"
	req.Header.Set("X-Real-IP", "203.0.113.77")

	if got, want := getClientIP(req), "203.0.113.77"; got != want {
		t.Fatalf("getClientIP() = %q, want %q", got, want)
	}
}

func resetTCPingCacheForTest(t *testing.T) {
	t.Helper()
	tcpingCacheMu.Lock()
	defer tcpingCacheMu.Unlock()
	tcpingCache = make(map[tcpingCacheKey]*tcpingCacheEntry)
	tcpingCacheBytes = 0
}

func TestTCPingCacheIsTargetScoped(t *testing.T) {
	resetTCPingCacheForTest(t)
	response := TCPingHistoryResponse{
		Results: []TCPingResult{{
			ClientID:  "client-a",
			Target:    "example.com",
			Timestamp: time.Now().UTC(),
		}},
	}

	cacheTCPingResults("client-a", "example.com", response)

	if _, ok := getCachedTCPingResultsJSON("client-a", "example.com"); !ok {
		t.Fatal("expected exact client+target cache hit")
	}
	if _, ok := getCachedTCPingResultsJSON("client-a", "other.example"); ok {
		t.Fatal("unexpected cache hit for different target")
	}
	if _, ok := getCachedTCPingResultsJSON("client-a", ""); ok {
		t.Fatal("unexpected cache hit for all-target history")
	}
}

func TestTCPingCacheSkipsAllTargetHistory(t *testing.T) {
	resetTCPingCacheForTest(t)

	cacheTCPingResults("client-a", "", TCPingHistoryResponse{})

	if _, ok := getCachedTCPingResultsJSON("client-a", ""); ok {
		t.Fatal("all-target history responses should not be cached")
	}
}

func TestTCPingCacheSkipsOversizedResponseWithoutPartialEntry(t *testing.T) {
	resetTCPingCacheForTest(t)
	oldMaxBytes := tcpingCacheMaxBytes
	tcpingCacheMaxBytes = 128
	t.Cleanup(func() {
		tcpingCacheMaxBytes = oldMaxBytes
	})

	response := TCPingHistoryResponse{
		Results: []TCPingResult{{
			ClientID:  "client-a",
			Target:    "very-long-target-name-that-makes-the-json-body-larger-than-the-test-cache-limit.example.com:443",
			Timestamp: time.Now().UTC(),
		}},
	}

	cacheTCPingResults("client-a", "example.com", response)

	if _, ok := getCachedTCPingResultsJSON("client-a", "example.com"); ok {
		t.Fatal("oversized TCPing history responses should skip cache instead of storing partial data")
	}
	if tcpingCacheBytes != 0 {
		t.Fatalf("tcpingCacheBytes = %d, want 0", tcpingCacheBytes)
	}
}

func TestExtractCountryKeepsWholeNames(t *testing.T) {
	cases := map[string]string{
		"":                               "",
		"US":                             "US",
		"de":                             "DE",
		"Hong Kong":                      "Hong Kong",
		"United States":                  "United States",
		"Los Angeles, CA, United States": "United States",
		"Frankfurt, DE":                  "DE",
		"Frankfurt, DE (Hetzner)":        "DE",
		"Tokyo, Japan 100-0001":          "Japan",
		"Seoul,  South   Korea ":         "South Korea",
		"Germany,":                       "Germany",
		"香港":                             "香港",
		"(somewhere)":                    "",
		"12345":                          "12345",
	}
	for in, want := range cases {
		if got := extractCountry(in); got != want {
			t.Errorf("extractCountry(%q) = %q, want %q", in, got, want)
		}
	}
}

// Four wrong passwords are just wrong; the fifth locks the client out and
// says so (429 with the wait), and while the lock holds even the right
// password gets the same answer.
func TestLoginLockoutSaysHowLongToWait(t *testing.T) {
	resetTrustedProxiesForTest(t, "")
	store := newTestStore(t)
	if err := store.SetPassword("correct-horse-2026"); err != nil {
		t.Fatal(err)
	}
	try := func(pw string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/api/auth/login", strings.NewReader(fmt.Sprintf(`{"password":%q}`, pw)))
		req.RemoteAddr = "192.0.2.45:5555"
		rec := httptest.NewRecorder()
		handleAuthLogin(store, rec, req)
		return rec
	}
	t.Cleanup(func() {
		loginAttemptsMu.Lock()
		delete(loginAttempts, "192.0.2.45")
		loginAttemptsMu.Unlock()
	})
	for i := 1; i <= 4; i++ {
		if rec := try(fmt.Sprintf("wrong-password-%d", i)); rec.Code != http.StatusUnauthorized {
			t.Fatalf("wrong password %d: status %d, want 401", i, rec.Code)
		}
	}
	for _, pw := range []string{"wrong-password-5", "correct-horse-2026"} {
		rec := try(pw)
		if rec.Code != http.StatusTooManyRequests {
			t.Fatalf("%s while locked: status %d, want 429", pw, rec.Code)
		}
		secs, err := strconv.Atoi(rec.Header().Get("Retry-After"))
		if err != nil || secs < 14*60 || secs > 15*60 {
			t.Fatalf("Retry-After = %q, want about 900 seconds", rec.Header().Get("Retry-After"))
		}
		var body struct {
			RetryAfter int `json:"retry_after"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil || body.RetryAfter != secs {
			t.Fatalf("body %q: retry_after should match the header (%d)", rec.Body.String(), secs)
		}
	}
}
