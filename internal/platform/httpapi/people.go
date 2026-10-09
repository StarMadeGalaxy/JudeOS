package httpapi

import (
	"encoding/json"
	"errors"
	"github.com/StarMadeGalaxy/JudeOS/internal/access"
	"github.com/StarMadeGalaxy/JudeOS/internal/people"
	"github.com/StarMadeGalaxy/JudeOS/internal/platform/requestmeta"
	"github.com/go-chi/chi/v5"
	"net/http"
	"strconv"
)

func registryError(w http.ResponseWriter, e error) {
	var f *people.Fault
	if !errors.As(e, &f) {
		accessError(w, e)
		return
	}
	if f.Status == 409 {
		respond(w, 409, map[string]any{"code": f.Code, "message": "Данные изменились. Обновите карточку.", "request_id": w.Header().Get("X-Request-ID"), "operation_id": f.Operation, "current_version": f.Version})
	} else {
		failure(w, f.Status, f.Code, "Запись не найдена")
	}
}
func registryRoutes(r chi.Router, o Options) {
	r.Group(func(r chi.Router) {
		r.Use(requestGuard(o))
		for _, kind := range []string{"people", "athletes", "households"} {
			id := "person_id"
			if kind == "athletes" {
				id = "athlete_id"
			}
			if kind == "households" {
				id = "household_id"
			}
			path := "/api/v1/tenants/{tenant_id}/" + kind
			r.Get(path, func(w http.ResponseWriter, req *http.Request) {
				q := req.URL.Query()
				for k, v := range q {
					if (k != "q" && k != "state" && k != "cursor" && k != "limit") || len(v) != 1 {
						accessError(w, access.ErrInvalid)
						return
					}
				}
				limit := 30
				var e error
				if q.Has("limit") {
					limit, e = strconv.Atoi(q.Get("limit"))
					if e != nil {
						accessError(w, access.ErrInvalid)
						return
					}
				}
				state := q.Get("state")
				if state == "" {
					state = "active"
				}
				v, e := people.New(o.Access).List(req.Context(), cookie(req, sessionCookie), chi.URLParam(req, "tenant_id"), requestmeta.ID(req.Context()), kind, q.Get("q"), state, q.Get("cursor"), limit)
				if e != nil {
					registryError(w, e)
					return
				}
				respond(w, 200, v)
			})
			r.Get(path+"/{"+id+"}", func(w http.ResponseWriter, req *http.Request) {
				v, e := people.New(o.Access).Get(req.Context(), cookie(req, sessionCookie), chi.URLParam(req, "tenant_id"), requestmeta.ID(req.Context()), kind, chi.URLParam(req, id))
				if e != nil {
					registryError(w, e)
					return
				}
				respond(w, 200, v)
			})
		}
		type route struct {
			method, path, kind, target, sub string
			status                          int
		}
		root := "/api/v1/tenants/{tenant_id}/"
		for _, v := range []route{
			{"POST", "people", "createPerson", "", "", 201}, {"PUT", "people/{person_id}", "updatePerson", "person_id", "", 200}, {"POST", "people/{person_id}/archive", "archivePerson", "person_id", "", 200},
			{"POST", "athletes", "createAthlete", "", "", 201}, {"PUT", "athletes/{athlete_id}", "updateAthlete", "athlete_id", "", 200}, {"POST", "athletes/{athlete_id}/archive", "archiveAthlete", "athlete_id", "", 200},
			{"POST", "athletes/{athlete_id}/guardian-links", "verifyGuardianLink", "athlete_id", "", 201}, {"POST", "athletes/{athlete_id}/guardian-links/{guardian_link_id}/revoke", "revokeGuardianLink", "athlete_id", "guardian_link_id", 200}, {"PUT", "athletes/{athlete_id}/primary-contact", "setPrimaryContact", "athlete_id", "", 200},
			{"POST", "households", "createHousehold", "", "", 201}, {"PUT", "households/{household_id}", "updateHousehold", "household_id", "", 200}, {"POST", "households/{household_id}/members", "addHouseholdMember", "household_id", "", 201}, {"POST", "households/{household_id}/members/{household_member_id}/end", "endHouseholdMember", "household_id", "household_member_id", 200},
		} {
			r.MethodFunc(v.method, root+v.path, func(w http.ResponseWriter, req *http.Request) {
				if req.Header.Get("X-CSRF-Token") == "" {
					accessError(w, access.ErrForbidden)
					return
				}
				var raw json.RawMessage
				if !body(w, req, &raw) {
					return
				}
				c, e := people.Decode(v.kind, raw)
				if e != nil {
					accessError(w, e)
					return
				}
				result, replayed, e := people.New(o.Access).Command(req.Context(), cookie(req, sessionCookie), req.Header.Get("X-CSRF-Token"), chi.URLParam(req, "tenant_id"), requestmeta.ID(req.Context()), v.kind, chi.URLParam(req, v.target), chi.URLParam(req, v.sub), c)
				if e != nil {
					registryError(w, e)
					return
				}
				w.Header().Set("Operation-Replayed", strconv.FormatBool(replayed))
				respond(w, v.status, result)
			})
		}
	})
}
