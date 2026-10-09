package httpapi

import (
	"bytes"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"github.com/StarMadeGalaxy/JudeOS/internal/access"
	"github.com/StarMadeGalaxy/JudeOS/internal/platform/requestmeta"
	"github.com/go-chi/chi/v5"
	"io"
	"mime"
	"net"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"
)

const sessionCookie = "__Host-judeos-session"
const preauthCookie = "__Host-judeos-preauth"

func cookie(req *http.Request, name string) string {
	c, e := req.Cookie(name)
	if e != nil {
		return ""
	}
	return c.Value
}
func setCookie(w http.ResponseWriter, name, value string, expires time.Time) {
	max := int(time.Until(expires).Seconds())
	if value == "" {
		max = -1
	}
	http.SetCookie(w, &http.Cookie{Name: name, Value: value, Path: "/", Secure: true, HttpOnly: true, SameSite: http.SameSiteLaxMode, Expires: expires, MaxAge: max})
}
func accessError(w http.ResponseWriter, err error) {
	status, code := 503, "SERVICE_UNAVAILABLE"
	switch {
	case errors.Is(err, access.ErrLimited):
		status, code = 429, "RATE_LIMITED"
		w.Header().Set("Retry-After", "2")
	case errors.Is(err, access.ErrUnauthorized):
		status, code = 401, "SESSION_EXPIRED"
	case errors.Is(err, access.ErrForbidden):
		status, code = 403, "ACCESS_DENIED"
	case errors.Is(err, access.ErrInvalid):
		status, code = 400, "INVALID_REQUEST"
	case errors.Is(err, access.ErrConflict):
		status, code = 409, "ACCESS_CONFLICT"
	case errors.Is(err, access.ErrToken):
		status, code = 400, "LINK_INVALID"
	}
	if status == 503 {
		w.Header().Set("Retry-After", "2")
	}
	failure(w, status, code, "Запрос не выполнен")
}
func body(w http.ResponseWriter, req *http.Request, target any) bool {
	kind, _, err := mime.ParseMediaType(req.Header.Get("Content-Type"))
	if err != nil || kind != "application/json" {
		failure(w, 415, "UNSUPPORTED_MEDIA_TYPE", "Требуется JSON")
		return false
	}
	req.Body = http.MaxBytesReader(w, req.Body, 16<<10)
	defer req.Body.Close()
	raw, err := io.ReadAll(req.Body)
	if err != nil {
		var large *http.MaxBytesError
		if errors.As(err, &large) {
			failure(w, 413, "PAYLOAD_TOO_LARGE", "Запрос слишком большой")
		} else {
			failure(w, 400, "INVALID_REQUEST", "Некорректный запрос")
		}
		return false
	}
	if !utf8.Valid(raw) || !uniqueJSON(raw) {
		failure(w, 400, "INVALID_REQUEST", "Некорректный запрос")
		return false
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	err = decoder.Decode(target)
	if err == nil {
		var extra any
		err = decoder.Decode(&extra)
		if err == io.EOF {
			return true
		}
	}
	var large *http.MaxBytesError
	if errors.As(err, &large) {
		failure(w, 413, "PAYLOAD_TOO_LARGE", "Запрос слишком большой")
	} else {
		failure(w, 400, "INVALID_REQUEST", "Некорректный запрос")
	}
	return false
}
func accessRoutes(r chi.Router, o Options) {
	// Register even when DB is unavailable, preserving route/contract coverage.

	r.Group(func(r chi.Router) {
		r.Use(requestGuard(o))
		r.Get("/api/v1/access/csrf", func(w http.ResponseWriter, req *http.Request) {
			csrf, expires, fresh, e := o.Access.CSRF(req.Context(), cookie(req, sessionCookie), cookie(req, preauthCookie))
			if e != nil {
				accessError(w, e)
				return
			}
			if fresh != "" {
				setCookie(w, preauthCookie, fresh, expires)
			}
			respond(w, 200, map[string]any{"csrf_token": csrf, "expires_at": expires})
		})
		r.Get("/api/v1/access/session", func(w http.ResponseWriter, req *http.Request) {
			v, e := o.Access.Session(req.Context(), cookie(req, sessionCookie))
			if e != nil {
				accessError(w, e)
				return
			}
			respond(w, 200, v)
		})
		r.Post("/api/v1/access/login", func(w http.ResponseWriter, req *http.Request) {
			var b struct {
				Login    string `json:"login"`
				Password string `json:"password"`
			}
			if !body(w, req, &b) {
				return
			}
			normalized, e := access.NormalizeLogin(b.Login)
			if e != nil || b.Password == "" || len(b.Password) > 1024 {
				accessError(w, access.ErrInvalid)
				return
			}
			host, _, _ := net.SplitHostPort(req.RemoteAddr)
			for _, key := range []string{"login-ip:" + host, "login-account:" + normalized} {
				ok, e := o.Access.Limit(req.Context(), key, 10, 15*time.Minute)
				if e != nil {
					accessError(w, e)
					return
				}
				if !ok {
					w.Header().Set("Retry-After", "900")
					failure(w, 429, "RATE_LIMITED", "Повторите позже")
					return
				}
			}
			v, token, e := o.Access.Login(req.Context(), normalized, b.Password, cookie(req, preauthCookie), req.Header.Get("X-CSRF-Token"), cookie(req, sessionCookie))
			if e != nil {
				if errors.Is(e, access.ErrUnauthorized) {
					failure(w, 401, "LOGIN_FAILED", "Не удалось войти")
				} else {
					accessError(w, e)
				}
				return
			}
			setCookie(w, sessionCookie, token, v.Expires)
			setCookie(w, preauthCookie, "", time.Unix(0, 0))
			respond(w, 200, v)
		})
		r.Post("/api/v1/access/logout", func(w http.ResponseWriter, req *http.Request) {
			e := o.Access.Logout(req.Context(), cookie(req, sessionCookie), req.Header.Get("X-CSRF-Token"))
			if e != nil {
				accessError(w, e)
				return
			}
			setCookie(w, sessionCookie, "", time.Unix(0, 0))
			w.WriteHeader(204)
		})
		r.Post("/api/v1/access/redeem", func(w http.ResponseWriter, req *http.Request) {
			var b struct {
				Token    string `json:"token"`
				Password string `json:"password"`
			}
			if !body(w, req, &b) {
				return
			}
			if len(b.Token) != 64 {
				accessError(w, access.ErrToken)
				return
			}
			// Authenticate preauth before allocating Argon2 memory, including invalid links.
			csrf, _, fresh, e := o.Access.CSRF(req.Context(), "", cookie(req, preauthCookie))
			if e != nil {
				accessError(w, e)
				return
			}
			if fresh != "" || subtle.ConstantTimeCompare([]byte(csrf), []byte(req.Header.Get("X-CSRF-Token"))) != 1 {
				accessError(w, access.ErrForbidden)
				return
			}
			host, _, _ := net.SplitHostPort(req.RemoteAddr)
			ok, e := o.Access.Limit(req.Context(), "redeem:"+host, 10, 15*time.Minute)
			if e != nil {
				accessError(w, e)
				return
			}
			if !ok {
				w.Header().Set("Retry-After", "900")
				failure(w, 429, "RATE_LIMITED", "Повторите позже")
				return
			}
			e = o.Access.Redeem(req.Context(), b.Token, b.Password, cookie(req, preauthCookie), req.Header.Get("X-CSRF-Token"), requestmeta.ID(req.Context()))
			if e != nil {
				accessError(w, e)
				return
			}
			setCookie(w, preauthCookie, "", time.Unix(0, 0))
			setCookie(w, sessionCookie, "", time.Unix(0, 0))
			w.WriteHeader(204)
		})
		r.Get("/api/v1/tenants/{tenant_id}/staff", func(w http.ResponseWriter, req *http.Request) {
			v, e := o.Access.List(req.Context(), cookie(req, sessionCookie), chi.URLParam(req, "tenant_id"), requestmeta.ID(req.Context()))
			if e != nil {
				accessError(w, e)
				return
			}
			respond(w, 200, map[string]any{"items": v})
		})
		r.Group(func(r chi.Router) {
			r.Group(func(r chi.Router) {
				r.Use(func(next http.Handler) http.Handler {
					return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
						if strings.TrimSpace(req.Header.Get("X-CSRF-Token")) == "" {
							accessError(w, access.ErrForbidden)
							return
						}
						next.ServeHTTP(w, req)
					})
				})
				r.Post("/api/v1/tenants/{tenant_id}/staff/invitations", func(w http.ResponseWriter, req *http.Request) {
					var b struct {
						Login  string         `json:"login"`
						Grants []access.Grant `json:"grants"`
					}
					if !body(w, req, &b) {
						return
					}
					v, e := o.Access.Invite(req.Context(), cookie(req, sessionCookie), req.Header.Get("X-CSRF-Token"), chi.URLParam(req, "tenant_id"), requestmeta.ID(req.Context()), b.Login, b.Grants)
					if e != nil {
						accessError(w, e)
						return
					}
					respond(w, 201, v)
				})
				r.Post("/api/v1/tenants/{tenant_id}/staff/{membership_id}/reset", func(w http.ResponseWriter, req *http.Request) {
					v, e := o.Access.Reset(req.Context(), cookie(req, sessionCookie), req.Header.Get("X-CSRF-Token"), chi.URLParam(req, "tenant_id"), requestmeta.ID(req.Context()), chi.URLParam(req, "membership_id"))
					if e != nil {
						accessError(w, e)
						return
					}
					respond(w, 201, v)
				})
				r.Put("/api/v1/tenants/{tenant_id}/staff/{membership_id}", func(w http.ResponseWriter, req *http.Request) {
					var b struct {
						Active *bool          `json:"active"`
						Grants []access.Grant `json:"grants"`
					}
					if !body(w, req, &b) {
						return
					}
					if b.Active == nil {
						accessError(w, access.ErrInvalid)
						return
					}
					e := o.Access.Change(req.Context(), cookie(req, sessionCookie), req.Header.Get("X-CSRF-Token"), chi.URLParam(req, "tenant_id"), requestmeta.ID(req.Context()), chi.URLParam(req, "membership_id"), *b.Active, b.Grants)
					if e != nil {
						accessError(w, e)
						return
					}
					w.WriteHeader(204)
				})
			})
		})
	})
}

func requestGuard(o Options) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			origin := req.Header.Get("Origin")
			site := req.Header.Get("Sec-Fetch-Site")
			if o.Origin == "" || (origin != "" && origin != o.Origin) || (site != "" && site != "same-origin" && site != "none") || (req.Method != "GET" && origin != o.Origin) {
				failure(w, 403, "ACCESS_DENIED", "Источник запроса не разрешён")
				return
			}
			if o.Access == nil {
				accessError(w, errors.New("unavailable"))
				return
			}
			host, _, err := net.SplitHostPort(req.RemoteAddr)
			if err != nil {
				host = req.RemoteAddr
			}
			allowed, err := o.Access.Limit(req.Context(), "http:"+host, 120, time.Minute)
			if err != nil {
				accessError(w, err)
				return
			}
			if !allowed {
				w.Header().Set("Retry-After", "60")
				failure(w, 429, "RATE_LIMITED", "Повторите позже")
				return
			}
			next.ServeHTTP(w, req)
		})
	}
}

// Reject duplicate keys at every depth: different JSON parsers must not resolve
// security-sensitive roles/identifiers to different values.
func uniqueJSON(raw []byte) bool {
	d := json.NewDecoder(bytes.NewReader(raw))
	var value func() bool
	value = func() bool {
		t, e := d.Token()
		if e != nil {
			return false
		}
		if x, ok := t.(json.Delim); ok {
			switch x {
			case '{':
				seen := map[string]bool{}
				for d.More() {
					k, e := d.Token()
					key, ok := k.(string)
					if e != nil || !ok || seen[key] {
						return false
					}
					seen[key] = true
					if !value() {
						return false
					}
				}
				t, e = d.Token()
				return e == nil && t == json.Delim('}')
			case '[':
				for d.More() {
					if !value() {
						return false
					}
				}
				t, e = d.Token()
				return e == nil && t == json.Delim(']')
			default:
				return false
			}
		}
		return true
	}
	if !value() {
		return false
	}
	_, e := d.Token()
	return e == io.EOF
}
