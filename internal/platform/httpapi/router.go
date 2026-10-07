package httpapi

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
)

type Options struct {
	Ready          func(context.Context) error
	WebDir, APIDir string
}

func New(o Options) *chi.Mux {
	r := chi.NewRouter()
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			var id [16]byte
			_, _ = rand.Read(id[:])
			w.Header().Set("X-Request-ID", hex.EncodeToString(id[:]))
			w.Header().Set("Cache-Control", "no-store")
			defer func() {
				if recover() != nil {
					failure(w, 500, "INTERNAL_ERROR", "Внутренняя ошибка")
				}
			}()
			next.ServeHTTP(w, req)
		})
	})
	r.NotFound(func(w http.ResponseWriter, _ *http.Request) {
		failure(w, 404, "NOT_FOUND", "Путь не найден")
	})
	r.MethodNotAllowed(func(w http.ResponseWriter, req *http.Request) {
		// Every currently implemented route is read-only. HEAD/OPTIONS are intentionally disabled.
		w.Header().Set("Allow", "GET")
		failure(w, 405, "METHOD_NOT_ALLOWED", "Метод не разрешён")
	})
	r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) { respond(w, 200, map[string]string{"status": "ok"}) })
	r.Get("/readyz", func(w http.ResponseWriter, req *http.Request) {
		ctx, cancel := context.WithTimeout(req.Context(), 2*time.Second)
		defer cancel()
		if o.Ready(ctx) != nil {
			w.Header().Set("Retry-After", "2")
			failure(w, 503, "SERVICE_UNAVAILABLE", "Сервис временно недоступен")
			return
		}
		respond(w, 200, map[string]string{"status": "ready"})
	})
	r.Get("/openapi.json", file(filepath.Join(o.APIDir, "runtime-openapi.json"), "application/json"))
	r.Get("/docs", file(filepath.Join(o.APIDir, "swagger/index.html"), "text/html; charset=utf-8"))
	r.Get("/docs/assets/swagger-ui.css", file(filepath.Join(o.APIDir, "swagger/swagger-ui.css"), "text/css"))
	r.Get("/docs/assets/swagger-ui-bundle.js", file(filepath.Join(o.APIDir, "swagger/swagger-ui-bundle.js"), "text/javascript"))
	r.Get("/", file(filepath.Join(o.WebDir, "index.html"), "text/html; charset=utf-8"))
	r.Get("/assets/*", func(w http.ResponseWriter, req *http.Request) {
		name := chi.URLParam(req, "*")
		if name == "" || strings.ContainsAny(name, "/\\") || name == "." || name == ".." {
			failure(w, 404, "NOT_FOUND", "Файл не найден")
			return
		}
		file(filepath.Join(o.WebDir, "assets", name), "")(w, req)
	})
	return r
}

func file(path, contentType string) http.HandlerFunc {
	return func(w http.ResponseWriter, req *http.Request) {
		f, err := os.Open(path)
		if err != nil {
			failure(w, 404, "NOT_FOUND", "Файл не найден")
			return
		}
		defer f.Close()
		stat, err := f.Stat()
		if err != nil || !stat.Mode().IsRegular() {
			failure(w, 404, "NOT_FOUND", "Файл не найден")
			return
		}
		kind := contentType
		if kind == "" {
			kind = mime.TypeByExtension(filepath.Ext(path))
		}
		if kind == "" {
			kind = "application/octet-stream"
		}
		w.Header().Set("Content-Type", kind)
		w.Header().Set("Content-Length", strconv.FormatInt(stat.Size(), 10))
		// Dev assets deliberately ignore Range/conditional requests: every response
		// keeps the same no-store policy and there is no partial-error text response.
		w.WriteHeader(http.StatusOK)
		_, _ = io.Copy(w, f)
	}
}

func failure(w http.ResponseWriter, status int, code, message string) {
	respond(w, status, map[string]string{"code": code, "message": message, "request_id": w.Header().Get("X-Request-ID")})
}
func respond(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

// Routes is the actual chi tree, consumed by the OpenAPI coverage check.
func Routes(r chi.Routes) ([]string, error) {
	var result []string
	err := chi.Walk(r, func(method, route string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		result = append(result, fmt.Sprintf("%s %s", method, route))
		return nil
	})
	return result, err
}
