package httpapi

import (
	"github.com/StarMadeGalaxy/JudeOS/internal/access"
	"github.com/StarMadeGalaxy/JudeOS/internal/platform/requestmeta"
	"github.com/go-chi/chi/v5"
	"net/http"
)

func networkRoutes(r chi.Router, o Options) {
	r.Group(func(r chi.Router) {
		r.Use(requestGuard(o))
		r.Post("/api/v1/platform/password-recovery", func(w http.ResponseWriter, req *http.Request) {
			var b struct {
				Login    string `json:"login"`
				Verified bool   `json:"identity_verified"`
			}
			if !body(w, req, &b) {
				return
			}
			v, e := o.Access.Recovery(req.Context(), cookie(req, sessionCookie), req.Header.Get("X-CSRF-Token"), requestmeta.ID(req.Context()), b.Login, b.Verified)
			if e != nil {
				accessError(w, e)
				return
			}
			respond(w, 201, v)
		})
		r.Get("/api/v1/networks", func(w http.ResponseWriter, req *http.Request) {
			v, e := o.Access.Session(req.Context(), cookie(req, sessionCookie))
			if e != nil {
				accessError(w, e)
				return
			}
			respond(w, 200, map[string]any{"items": v.Networks, "platform_administrator": v.Platform})
		})
		r.Get("/api/v1/networks/{network_id}", func(w http.ResponseWriter, req *http.Request) {
			v, e := o.Access.Network(req.Context(), cookie(req, sessionCookie), chi.URLParam(req, "network_id"), requestmeta.ID(req.Context()))
			if e != nil {
				accessError(w, e)
				return
			}
			respond(w, 200, v)
		})
		for _, path := range []string{"/api/v1/platform/networks", "/api/v1/tenants/{tenant_id}/network"} {
			r.Post(path, func(w http.ResponseWriter, req *http.Request) {
				var b struct {
					Name string `json:"name"`
				}
				if !body(w, req, &b) {
					return
				}
				var v access.NetworkProfile
				var e error
				if path == "/api/v1/platform/networks" {
					v, e = o.Access.PlatformNetwork(req.Context(), cookie(req, sessionCookie), req.Header.Get("X-CSRF-Token"), requestmeta.ID(req.Context()), b.Name)
				} else {
					v, e = o.Access.CreateNetwork(req.Context(), cookie(req, sessionCookie), req.Header.Get("X-CSRF-Token"), chi.URLParam(req, "tenant_id"), requestmeta.ID(req.Context()), b.Name)
				}
				if e != nil {
					accessError(w, e)
					return
				}
				respond(w, 201, v)
			})
		}
		r.Put("/api/v1/networks/{network_id}", func(w http.ResponseWriter, req *http.Request) {
			var b struct {
				Name string `json:"name"`
				Base int64  `json:"base_version"`
			}
			if !body(w, req, &b) {
				return
			}
			v, e := o.Access.RenameNetwork(req.Context(), cookie(req, sessionCookie), req.Header.Get("X-CSRF-Token"), chi.URLParam(req, "network_id"), requestmeta.ID(req.Context()), b.Name, b.Base)
			if e != nil {
				accessError(w, e)
				return
			}
			respond(w, 200, v)
		})
		for _, method := range []string{"POST", "PUT"} {
			path := "/api/v1/networks/{network_id}/clubs"
			if method == "PUT" {
				path += "/{tenant_id}"
			}
			r.MethodFunc(method, path, func(w http.ResponseWriter, req *http.Request) {
				var b struct {
					Name    string `json:"name"`
					Address string `json:"address"`
					Base    int64  `json:"base_version"`
				}
				if !body(w, req, &b) {
					return
				}
				v, e := o.Access.SaveClub(req.Context(), cookie(req, sessionCookie), req.Header.Get("X-CSRF-Token"), chi.URLParam(req, "network_id"), chi.URLParam(req, "tenant_id"), requestmeta.ID(req.Context()), b.Name, b.Address, b.Base)
				if e != nil {
					accessError(w, e)
					return
				}
				status := 200
				if method == "POST" {
					status = 201
				}
				respond(w, status, v)
			})
		}
		for _, path := range []string{"/api/v1/networks/{network_id}/owners", "/api/v1/platform/administrators"} {
			r.Put(path, func(w http.ResponseWriter, req *http.Request) {
				var b struct {
					Login  string `json:"login"`
					Active *bool  `json:"active"`
				}
				if !body(w, req, &b) {
					return
				}
				if b.Active == nil {
					accessError(w, access.ErrInvalid)
					return
				}
				var e error
				if path == "/api/v1/platform/administrators" {
					e = o.Access.PlatformAdministrator(req.Context(), cookie(req, sessionCookie), req.Header.Get("X-CSRF-Token"), requestmeta.ID(req.Context()), b.Login, *b.Active)
				} else {
					e = o.Access.NetworkOwner(req.Context(), cookie(req, sessionCookie), req.Header.Get("X-CSRF-Token"), chi.URLParam(req, "network_id"), requestmeta.ID(req.Context()), b.Login, *b.Active)
				}
				if e != nil {
					accessError(w, e)
					return
				}
				w.WriteHeader(204)
			})
		}
		r.Post("/api/v1/access/accept-invitation", func(w http.ResponseWriter, req *http.Request) {
			var b struct {
				Token string `json:"token"`
			}
			if !body(w, req, &b) {
				return
			}
			e := o.Access.AcceptInvitation(req.Context(), cookie(req, sessionCookie), req.Header.Get("X-CSRF-Token"), b.Token, requestmeta.ID(req.Context()))
			if e != nil {
				accessError(w, e)
				return
			}
			w.WriteHeader(204)
		})
		r.Post("/api/v1/tenants/{tenant_id}/staff/assignments", func(w http.ResponseWriter, req *http.Request) {
			var b struct {
				Login  string         `json:"login"`
				Grants []access.Grant `json:"grants"`
			}
			if !body(w, req, &b) {
				return
			}
			v, e := o.Access.AssignStaff(req.Context(), cookie(req, sessionCookie), req.Header.Get("X-CSRF-Token"), chi.URLParam(req, "tenant_id"), requestmeta.ID(req.Context()), b.Login, b.Grants)
			if e != nil {
				accessError(w, e)
				return
			}
			respond(w, 201, v)
		})
		r.Get("/api/v1/tenants/{tenant_id}/coaches", func(w http.ResponseWriter, req *http.Request) {
			v, e := o.Access.Coaches(req.Context(), cookie(req, sessionCookie), chi.URLParam(req, "tenant_id"), requestmeta.ID(req.Context()))
			if e != nil {
				accessError(w, e)
				return
			}
			respond(w, 200, map[string]any{"items": v})
		})
		r.Post("/api/v1/tenants/{tenant_id}/coaches/{membership_id}/revoke", func(w http.ResponseWriter, req *http.Request) {
			e := o.Access.RevokeCoach(req.Context(), cookie(req, sessionCookie), req.Header.Get("X-CSRF-Token"), chi.URLParam(req, "tenant_id"), chi.URLParam(req, "membership_id"), requestmeta.ID(req.Context()))
			if e != nil {
				accessError(w, e)
				return
			}
			w.WriteHeader(204)
		})
	})
}
