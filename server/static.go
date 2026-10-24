package main

import (
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"io/fs"
	"mime"
	"net/http"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
)

// staticHandler serves the embedded frontend in standalone mode. API routes go
// to api; files come from the embedded dist tree; an extensionless path that
// is not a file falls back to its directory's index.html, then to the root
// index.html (SPA routes). Directory URLs without a trailing slash and
// ".../index.html" URLs are left to http.FileServer, which redirects them.
//
// Text files (HTML, JS, CSS, SVG, JSON) are served gzip-compressed to browsers
// that accept it — the bundle shrinks from about 100 KB to 30 KB — and every
// file carries a content-hash ETag, so revalidating an unchanged page (HTML is
// no-cache) costs a 304 instead of the whole page. Compressed copies are made
// once per file: embedded files never change while the process runs.
type staticHandler struct {
	dist  fs.FS
	api   http.Handler
	files http.Handler

	mu    sync.Mutex
	cache map[string]*staticFile
}

type staticFile struct {
	body []byte
	gz   []byte // nil when compression does not pay off
	etag string // quoted content hash of body
}

func newStaticHandler(dist fs.FS, api http.Handler) *staticHandler {
	return &staticHandler{dist: dist, api: api, files: http.FileServer(http.FS(dist)), cache: map[string]*staticFile{}}
}

func (h *staticHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if strings.HasPrefix(r.URL.Path, "/api/") || r.URL.Path == "/healthz" {
		h.api.ServeHTTP(w, r)
		return
	}

	// Reject invalid filesystem paths before any embedded-FS lookup or SPA
	// fallback, so traversal probes such as /../admin never turn into a
	// successful index.html response.
	name, ok := staticFilePathFromURL(r.URL.Path)
	if !ok {
		http.NotFound(w, r)
		return
	}

	if info, err := fs.Stat(h.dist, name); err == nil {
		setStaticCacheHeaders(w, r.URL.Path)
		if info.IsDir() {
			if !strings.HasSuffix(r.URL.Path, "/") {
				h.files.ServeHTTP(w, r) // redirects /admin to /admin/
				return
			}
			// A directory answers with its index page, never with a listing.
			if !h.serveFile(w, r, path.Join(name, "index.html")) {
				http.NotFound(w, r)
			}
			return
		}
		if strings.HasSuffix(r.URL.Path, "/index.html") {
			h.files.ServeHTTP(w, r) // redirects .../index.html to ./
			return
		}
		if !h.serveFile(w, r, name) {
			h.files.ServeHTTP(w, r)
		}
		return
	}

	if filepath.Ext(name) != "" {
		http.NotFound(w, r)
		return
	}
	// /admin → admin/index.html when it exists, otherwise the root page.
	index := strings.TrimSuffix(name, "/") + "/index.html"
	if _, err := fs.Stat(h.dist, index); err != nil {
		index = "index.html"
	}
	setStaticCacheHeaders(w, r.URL.Path)
	if !h.serveFile(w, r, index) {
		http.Error(w, "index.html not found", http.StatusNotFound)
	}
}

// serveFile answers with the gzip copy of a text file when the client accepts
// it, and writes HTML itself either way (no FileServer redirects for the SPA
// fallback). For any other file it only sets the validators and returns false
// so http.FileServer writes the response — honouring If-None-Match against
// the ETag set here. It reports whether the response was written.
func (h *staticHandler) serveFile(w http.ResponseWriter, r *http.Request, name string) bool {
	f := h.load(name)
	if f == nil {
		return false
	}
	compressible := isCompressibleStatic(name)
	if compressible {
		w.Header().Add("Vary", "Accept-Encoding")
	}
	useGzip := f.gz != nil && acceptsGzip(r)
	isHTML := strings.EqualFold(path.Ext(name), ".html")
	if !useGzip && !isHTML {
		w.Header().Set("ETag", f.etag)
		return false
	}

	body, etag := f.body, f.etag
	if useGzip {
		body = f.gz
		etag = strings.TrimSuffix(f.etag, `"`) + `-gz"`
		w.Header().Set("Content-Encoding", "gzip")
	}
	w.Header().Set("ETag", etag)
	if ct := mime.TypeByExtension(path.Ext(name)); ct != "" {
		w.Header().Set("Content-Type", ct)
	} else {
		w.Header().Set("Content-Type", http.DetectContentType(f.body))
	}
	if etagMatches(r.Header.Get("If-None-Match"), etag) {
		w.WriteHeader(http.StatusNotModified)
		return true
	}
	w.Header().Set("Content-Length", strconv.Itoa(len(body)))
	w.WriteHeader(http.StatusOK)
	if r.Method != http.MethodHead {
		_, _ = w.Write(body)
	}
	return true
}

func (h *staticHandler) load(name string) *staticFile {
	h.mu.Lock()
	defer h.mu.Unlock()
	if f, ok := h.cache[name]; ok {
		return f
	}
	body, err := fs.ReadFile(h.dist, name)
	if err != nil {
		return nil
	}
	sum := sha256.Sum256(body)
	f := &staticFile{body: body, etag: `"` + hex.EncodeToString(sum[:16]) + `"`}
	if isCompressibleStatic(name) && len(body) >= 512 {
		var buf bytes.Buffer
		zw, _ := gzip.NewWriterLevel(&buf, gzip.BestCompression)
		_, _ = zw.Write(body)
		if zw.Close() == nil && buf.Len() < len(body)*9/10 {
			f.gz = buf.Bytes()
		}
	}
	h.cache[name] = f
	return f
}

func isCompressibleStatic(name string) bool {
	switch strings.ToLower(path.Ext(name)) {
	case ".html", ".js", ".mjs", ".css", ".svg", ".json", ".txt", ".xml":
		return true
	}
	return false
}

// etagMatches implements If-None-Match for GET/HEAD (weak comparison).
func etagMatches(header, etag string) bool {
	if header == "" {
		return false
	}
	for _, candidate := range strings.Split(header, ",") {
		candidate = strings.TrimSpace(candidate)
		if candidate == "*" || strings.TrimPrefix(candidate, "W/") == etag {
			return true
		}
	}
	return false
}

// setStaticCacheHeaders mirrors the two-tier caching strategy the nginx config
// uses in Docker mode (see docker/nginx.conf):
//
//  1. HTML entrypoints (*.html and the directory-less SPA routes like /admin,
//     /login) → Cache-Control: no-cache, must-revalidate. The ETag means a
//     revalidation costs a cheap 304 when the page really hasn't changed,
//     while guaranteeing browsers notice a new deployment.
//
//  2. Content-addressed bundle assets under /_astro/ (Astro fingerprints every
//     filename with a content hash, so a changed asset is always served under
//     a new URL) → Cache-Control: public, max-age=31536000, s-maxage=31536000,
//     immutable. "immutable" tells the browser not even to revalidate.
//
//  3. Non-fingerprinted static files such as favicon.svg / robots.txt get a
//     short browser TTL and a modest CDN TTL. They are cacheable, but not
//     immutable because their URL does not change on deploy.
func setStaticCacheHeaders(w http.ResponseWriter, urlPath string) {
	switch {
	case strings.HasSuffix(urlPath, ".html") || urlPath == "/" || filepath.Ext(urlPath) == "":
		w.Header().Set("Cache-Control", "no-cache, must-revalidate")
	case strings.HasPrefix(urlPath, "/_astro/"):
		w.Header().Set("Cache-Control", "public, max-age=31536000, s-maxage=31536000, immutable")
	case urlPath == "/favicon.svg" || urlPath == "/robots.txt":
		w.Header().Set("Cache-Control", "public, max-age=3600, s-maxage=86400")
	case isStaticAssetPath(urlPath):
		w.Header().Set("Cache-Control", "public, max-age=86400, s-maxage=604800")
	}
}

func isStaticAssetPath(urlPath string) bool {
	switch strings.ToLower(filepath.Ext(urlPath)) {
	case ".png", ".jpg", ".jpeg", ".gif", ".ico", ".svg", ".woff", ".woff2":
		return true
	default:
		return false
	}
}
