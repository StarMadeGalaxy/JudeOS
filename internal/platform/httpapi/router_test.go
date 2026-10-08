package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/StarMadeGalaxy/JudeOS/internal/platform/requestmeta"
)

func TestReadinessDoesNotLeakDatabaseErrors(t *testing.T) {
	r := New(Options{Ready: func(context.Context) error { return errors.New("postgres://secret@host/private") }})
	for _, tc := range []struct {
		path   string
		status int
		code   string
	}{{"/healthz", 200, ""}, {"/readyz", 503, "SERVICE_UNAVAILABLE"}, {"/api/v1/access/session", 403, "ACCESS_DENIED"}, {"/healthz/", 404, "NOT_FOUND"}} {
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest("GET", tc.path, nil))
		if w.Code != tc.status {
			t.Fatalf("%s: %d", tc.path, w.Code)
		}
		var body map[string]string
		if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		if body["code"] != tc.code {
			t.Fatal(body)
		}
		if tc.code != "" && body["request_id"] != w.Header().Get("X-Request-ID") {
			t.Fatal("request id mismatch")
		}
		if w.Header().Get("Cache-Control") != "no-store" {
			t.Fatal("cache policy")
		}
		if tc.status == 503 && w.Header().Get("Retry-After") != "2" {
			t.Fatal("retry policy")
		}
		if body["message"] == "postgres://secret@host/private" {
			t.Fatal("secret exposed")
		}
	}
}

func TestMethodAndStaticBoundaries(t *testing.T) {
	dir := t.TempDir()
	if err := os.Mkdir(filepath.Join(dir, "assets"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "assets", "app.js"), []byte("export {}"), 0600); err != nil {
		t.Fatal(err)
	}
	r := New(Options{WebDir: dir, Ready: func(context.Context) error { return nil }})
	rangeRequest := httptest.NewRequest("GET", "/assets/app.js", nil)
	rangeRequest.Header.Set("Range", "bytes=999-1000")
	rangeResponse := httptest.NewRecorder()
	r.ServeHTTP(rangeResponse, rangeRequest)
	if rangeResponse.Code != 200 || rangeResponse.Header().Get("Cache-Control") != "no-store" || rangeResponse.Body.String() != "export {}" {
		t.Fatal("dev assets must ignore Range and preserve the complete no-store response")
	}
	for _, tc := range []struct {
		method, path string
		status       int
	}{{"HEAD", "/healthz", 405}, {"OPTIONS", "/readyz", 405}, {"POST", "/", 405}, {"GET", "/assets/app.js", 200}, {"GET", "/assets/../go.mod", 404}, {"GET", "/assets/", 404}, {"GET", "/missing", 404}, {"GET", "/readyz", 200}} {
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest(tc.method, tc.path, nil))
		if w.Code != tc.status {
			t.Fatalf("%s %s: %d", tc.method, tc.path, w.Code)
		}
		if tc.status == 405 && w.Header().Get("Allow") != "GET" {
			t.Fatal("Allow missing")
		}
	}
}

var _ http.Handler = New(Options{})

func TestLogsAndPanicUseServerRequestIDWithoutSensitiveInput(t *testing.T) {
	var logs bytes.Buffer
	secret := "synthetic-contact-password@example.invalid"
	var seenID string
	r := New(Options{Logger: slog.New(slog.NewJSONHandler(&logs, nil)), Ready: func(ctx context.Context) error {
		seenID = requestmeta.ID(ctx)
		panic(secret)
	}})
	for _, path := range []string{"/readyz?password=" + secret, "/assets/" + secret, "/" + secret} {
		req := httptest.NewRequest("GET", path, strings.NewReader(secret))
		req.Header.Set("Authorization", "Bearer "+secret)
		req.Header.Set("Cookie", "session="+secret)
		req.Header.Set("X-Request-ID", secret)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		id := w.Header().Get("X-Request-ID")
		if len(id) != 32 || id == secret || !strings.Contains(logs.String(), id) {
			t.Fatal("server correlation missing")
		}
		if strings.HasPrefix(path, "/readyz") {
			if w.Code != 500 || seenID != id || !strings.Contains(w.Body.String(), id) {
				t.Fatal("panic correlation failed")
			}
		}
		if strings.Contains(w.Body.String(), secret) || strings.Contains(logs.String(), secret) {
			t.Fatal("sensitive request/panic logged")
		}
	}
}
