package main

import (
	"bytes"
	"compress/gzip"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"testing/fstest"
)

func staticTestFS() fstest.MapFS {
	page := func(title string) []byte {
		return []byte("<!doctype html><html><head><title>" + title + "</title></head><body>" + strings.Repeat("<p>dashboard row</p>", 60) + "</body></html>")
	}
	return fstest.MapFS{
		"index.html":       {Data: page("home")},
		"admin/index.html": {Data: page("admin")},
		"_astro/app.js":    {Data: []byte(strings.Repeat("export const value = 'pulse';\n", 80))},
		"small.txt":        {Data: []byte("hello")},
		"favicon.png":      {Data: []byte("\x89PNG\r\n\x1a\n" + strings.Repeat("\x00\x01\x02", 400))},
	}
}

func staticGet(t *testing.T, h http.Handler, method, target string, headers map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, target, nil)
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	return rr
}

func gunzip(t *testing.T, b []byte) []byte {
	t.Helper()
	zr, err := gzip.NewReader(bytes.NewReader(b))
	if err != nil {
		t.Fatalf("not gzip: %v", err)
	}
	out, err := io.ReadAll(zr)
	if err != nil {
		t.Fatalf("gunzip: %v", err)
	}
	return out
}

func TestStaticHandlerServesGzipWithValidators(t *testing.T) {
	dist := staticTestFS()
	h := newStaticHandler(dist, http.NotFoundHandler())
	gz := map[string]string{"Accept-Encoding": "gzip, deflate, br"}

	rr := staticGet(t, h, http.MethodGet, "/_astro/app.js", gz)
	if rr.Code != http.StatusOK || rr.Header().Get("Content-Encoding") != "gzip" {
		t.Fatalf("gzip JS: status %d, encoding %q", rr.Code, rr.Header().Get("Content-Encoding"))
	}
	if got := gunzip(t, rr.Body.Bytes()); !bytes.Equal(got, dist["_astro/app.js"].Data) {
		t.Fatalf("gzip JS body differs from the file")
	}
	if !strings.Contains(rr.Header().Get("Vary"), "Accept-Encoding") || !strings.Contains(rr.Header().Get("Cache-Control"), "immutable") {
		t.Fatalf("gzip JS headers: vary %q cache %q", rr.Header().Get("Vary"), rr.Header().Get("Cache-Control"))
	}
	if !strings.HasPrefix(rr.Header().Get("Content-Type"), "text/javascript") {
		t.Fatalf("gzip JS content type %q", rr.Header().Get("Content-Type"))
	}
	gzBody := rr.Body.Bytes()
	gzTag := rr.Header().Get("ETag")
	if !strings.HasSuffix(gzTag, `-gz"`) {
		t.Fatalf("gzip ETag %q", gzTag)
	}

	plain := staticGet(t, h, http.MethodGet, "/_astro/app.js", nil)
	if plain.Code != http.StatusOK || plain.Header().Get("Content-Encoding") != "" || !bytes.Equal(plain.Body.Bytes(), dist["_astro/app.js"].Data) {
		t.Fatalf("identity JS: status %d encoding %q", plain.Code, plain.Header().Get("Content-Encoding"))
	}
	if !strings.Contains(plain.Header().Get("Vary"), "Accept-Encoding") || plain.Header().Get("ETag") == "" || plain.Header().Get("ETag") == gzTag {
		t.Fatalf("identity JS validators: vary %q etag %q", plain.Header().Get("Vary"), plain.Header().Get("ETag"))
	}

	refused := staticGet(t, h, http.MethodGet, "/_astro/app.js", map[string]string{"Accept-Encoding": "gzip;q=0, identity"})
	if refused.Header().Get("Content-Encoding") != "" {
		t.Fatalf("gzip;q=0 still got gzip")
	}

	if rr := staticGet(t, h, http.MethodGet, "/_astro/app.js", map[string]string{"Accept-Encoding": "gzip", "If-None-Match": gzTag}); rr.Code != http.StatusNotModified || rr.Body.Len() != 0 {
		t.Fatalf("gzip revalidation: status %d, %d bytes", rr.Code, rr.Body.Len())
	}
	if rr := staticGet(t, h, http.MethodGet, "/_astro/app.js", map[string]string{"If-None-Match": plain.Header().Get("ETag")}); rr.Code != http.StatusNotModified {
		t.Fatalf("identity revalidation: status %d", rr.Code)
	}

	head := staticGet(t, h, http.MethodHead, "/_astro/app.js", gz)
	if head.Code != http.StatusOK || head.Body.Len() != 0 || head.Header().Get("Content-Length") != strconv.Itoa(len(gzBody)) {
		t.Fatalf("HEAD: status %d, body %d, length %q", head.Code, head.Body.Len(), head.Header().Get("Content-Length"))
	}

	png := staticGet(t, h, http.MethodGet, "/favicon.png", gz)
	if png.Code != http.StatusOK || png.Header().Get("Content-Encoding") != "" || png.Header().Get("Vary") != "" || png.Header().Get("ETag") == "" {
		t.Fatalf("PNG: status %d encoding %q vary %q etag %q", png.Code, png.Header().Get("Content-Encoding"), png.Header().Get("Vary"), png.Header().Get("ETag"))
	}
	small := staticGet(t, h, http.MethodGet, "/small.txt", gz)
	if small.Code != http.StatusOK || small.Header().Get("Content-Encoding") != "" || small.Body.String() != "hello" {
		t.Fatalf("small text: status %d encoding %q body %q", small.Code, small.Header().Get("Content-Encoding"), small.Body.String())
	}
}

func TestStaticHandlerKeepsRoutingAndRedirects(t *testing.T) {
	dist := staticTestFS()
	apiHit := false
	h := newStaticHandler(dist, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { apiHit = true }))
	gz := map[string]string{"Accept-Encoding": "gzip"}

	home := staticGet(t, h, http.MethodGet, "/", gz)
	if home.Code != http.StatusOK || !bytes.Contains(gunzip(t, home.Body.Bytes()), []byte("<title>home</title>")) {
		t.Fatalf("home: status %d", home.Code)
	}
	if !strings.HasPrefix(home.Header().Get("Content-Type"), "text/html") || home.Header().Get("Cache-Control") != "no-cache, must-revalidate" {
		t.Fatalf("home headers: type %q cache %q", home.Header().Get("Content-Type"), home.Header().Get("Cache-Control"))
	}
	if rr := staticGet(t, h, http.MethodGet, "/", map[string]string{"Accept-Encoding": "gzip", "If-None-Match": home.Header().Get("ETag")}); rr.Code != http.StatusNotModified {
		t.Fatalf("home revalidation: status %d", rr.Code)
	}
	plainHome := staticGet(t, h, http.MethodGet, "/", nil)
	if plainHome.Code != http.StatusOK || plainHome.Header().Get("Content-Encoding") != "" || !bytes.Equal(plainHome.Body.Bytes(), dist["index.html"].Data) {
		t.Fatalf("identity home: status %d", plainHome.Code)
	}

	for target, want := range map[string]string{"/admin": "admin/", "/index.html": "./", "/admin/index.html": "./"} {
		rr := staticGet(t, h, http.MethodGet, target, gz)
		if rr.Code != http.StatusMovedPermanently || rr.Header().Get("Location") != want {
			t.Fatalf("%s: status %d location %q, want 301 %q", target, rr.Code, rr.Header().Get("Location"), want)
		}
	}
	admin := staticGet(t, h, http.MethodGet, "/admin/", gz)
	if admin.Code != http.StatusOK || !bytes.Contains(gunzip(t, admin.Body.Bytes()), []byte("<title>admin</title>")) {
		t.Fatalf("/admin/: status %d", admin.Code)
	}
	spa := staticGet(t, h, http.MethodGet, "/servers/42", nil)
	if spa.Code != http.StatusOK || !bytes.Contains(spa.Body.Bytes(), []byte("<title>home</title>")) || spa.Header().Get("Cache-Control") != "no-cache, must-revalidate" {
		t.Fatalf("SPA fallback: status %d", spa.Code)
	}
	if rr := staticGet(t, h, http.MethodGet, "/_astro/", nil); rr.Code != http.StatusNotFound {
		t.Fatalf("a directory without an index must not be listed: status %d", rr.Code)
	}
	if rr := staticGet(t, h, http.MethodGet, "/missing.js", gz); rr.Code != http.StatusNotFound {
		t.Fatalf("missing file: status %d", rr.Code)
	}
	if rr := staticGet(t, h, http.MethodGet, "/../admin", gz); rr.Code != http.StatusNotFound {
		t.Fatalf("traversal probe: status %d", rr.Code)
	}
	if staticGet(t, h, http.MethodGet, "/api/metrics", nil); !apiHit {
		t.Fatalf("API route did not reach the API handler")
	}
}
