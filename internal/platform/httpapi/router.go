package httpapi

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/StarMadeGalaxy/JudeOS/internal/access"
	"github.com/StarMadeGalaxy/JudeOS/internal/platform/requestmeta"
	"github.com/go-chi/chi/v5"
)

type Options struct {
	Access         *access.Service
	Origin         string
	Ready          func(context.Context) error
	WebDir, APIDir string
	Logger         *slog.Logger
}

func New(o Options) *chi.Mux {
	logger := o.Logger
	if logger == nil {
		logger = slog.Default()
	}
	r := chi.NewRouter()
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			var id [16]byte
			_, _ = rand.Read(id[:])
			requestID := hex.EncodeToString(id[:])
			req = req.WithContext(requestmeta.WithID(req.Context(), requestID))
			w.Header().Set("X-Request-ID", requestID)
			w.Header().Set("Cache-Control", "no-store")
			response := &statusWriter{ResponseWriter: w}
			started := time.Now()
			defer func() {
				if recover() != nil {
					logger.Error("request failed", "request_id", requestID, "code", "INTERNAL_ERROR")
					if response.status == 0 {
						failure(response, 500, "INTERNAL_ERROR", "Внутренняя ошибка")
					}
				}
				// Only registered route patterns are logged: never URL/query, headers,
				// body, arbitrary method, actor/contact data, raw error or panic value.
				route := chi.RouteContext(req.Context()).RoutePattern()
				if route == "" {
					route = "unmatched"
				}
				status := response.status
				if status == 0 {
					status = 200
				}
				logger.Info("request completed", "request_id", requestID, "route", route, "status", status, "duration_ms", time.Since(started).Milliseconds())
			}()
			next.ServeHTTP(response, req)
		})
	})
	r.NotFound(func(w http.ResponseWriter, _ *http.Request) {
		failure(w, 404, "NOT_FOUND", "Путь не найден")
	})
	r.MethodNotAllowed(func(w http.ResponseWriter, req *http.Request) {
		methods := []string{}
		_ = chi.Walk(r, func(method, pattern string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
			matcher := chi.NewRouter()
			matcher.Method(method, pattern, http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
			if matcher.Match(chi.NewRouteContext(), method, req.URL.Path) {
				methods = append(methods, method)
			}
			return nil
		})
		sort.Strings(methods)
		w.Header().Set("Allow", strings.Join(methods, ", "))
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
	accessRoutes(r, o)
	return r
}

type statusWriter struct {
	http.ResponseWriter
	status int
}

func (w *statusWriter) WriteHeader(status int) {
	if w.status != 0 {
		return
	}
	w.status = status
	w.ResponseWriter.WriteHeader(status)
}
func (w *statusWriter) Write(b []byte) (int, error) {
	if w.status == 0 {
		w.WriteHeader(200)
	}
	return w.ResponseWriter.Write(b)
}
func (w *statusWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }

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
