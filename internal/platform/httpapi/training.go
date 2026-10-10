package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/StarMadeGalaxy/JudeOS/internal/access"
	"github.com/StarMadeGalaxy/JudeOS/internal/platform/requestmeta"
	"github.com/StarMadeGalaxy/JudeOS/internal/training"
	"github.com/go-chi/chi/v5"
)

func trainingError(w http.ResponseWriter, e error) {
	var f *training.Fault
	if !errors.As(e, &f) {
		accessError(w, e)
		return
	}
	if f.Status == 409 {
		respond(w, 409, map[string]any{"code": f.Code, "message": "Данные изменились. Обновите занятие или группу.", "request_id": w.Header().Get("X-Request-ID"), "operation_id": f.Operation, "current_version": f.Version})
	} else {
		failure(w, f.Status, f.Code, "Запись не найдена")
	}
}
func trainingRoutes(r chi.Router, o Options) {
	r.Group(func(r chi.Router) {
		r.Use(requestGuard(o))
		service := training.New(o.Access)
		root := "/api/v1/tenants/{tenant_id}/"
		for _, kind := range []string{"venues", "disciplines", "groups"} {
			id := "group_id"
			if kind == "venues" {
				id = "venue_id"
			}
			if kind == "disciplines" {
				id = "discipline_id"
			}
			r.Get(root+kind, func(w http.ResponseWriter, req *http.Request) {
				q := req.URL.Query()
				for k, v := range q {
					if (k != "q" && k != "state" && k != "cursor" && k != "limit") || len(v) != 1 {
						accessError(w, access.ErrInvalid)
						return
					}
				}
				limit := 30
				if q.Has("limit") {
					var e error
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
				v, e := service.List(req.Context(), cookie(req, sessionCookie), chi.URLParam(req, "tenant_id"), requestmeta.ID(req.Context()), kind, q.Get("q"), state, q.Get("cursor"), limit)
				if e != nil {
					trainingError(w, e)
					return
				}
				respond(w, 200, v)
			})
			r.Get(root+kind+"/{"+id+"}", func(w http.ResponseWriter, req *http.Request) {
				if len(req.URL.Query()) > 0 {
					accessError(w, access.ErrInvalid)
					return
				}
				v, e := service.Get(req.Context(), cookie(req, sessionCookie), chi.URLParam(req, "tenant_id"), requestmeta.ID(req.Context()), kind, chi.URLParam(req, id))
				if e != nil {
					trainingError(w, e)
					return
				}
				respond(w, 200, v)
			})
		}
		r.Get(root+"sessions", func(w http.ResponseWriter, req *http.Request) {
			q := req.URL.Query()
			for k, v := range q {
				if (k != "date" && k != "cursor" && k != "limit") || len(v) != 1 {
					accessError(w, access.ErrInvalid)
					return
				}
			}
			limit := 50
			if q.Has("limit") {
				var e error
				limit, e = strconv.Atoi(q.Get("limit"))
				if e != nil {
					accessError(w, access.ErrInvalid)
					return
				}
			}
			if q.Has("cursor") && q.Get("cursor") == "" {
				accessError(w, access.ErrInvalid)
				return
			}
			v, e := service.ListSessions(req.Context(), cookie(req, sessionCookie), chi.URLParam(req, "tenant_id"), requestmeta.ID(req.Context()), q.Get("date"), q.Get("cursor"), limit)
			if e != nil {
				trainingError(w, e)
				return
			}
			respond(w, 200, v)
		})
		for _, resource := range []struct{ suffix, kind string }{{"", "sessions"}, {"/coaches", "coaches"}} {
			r.Get(root+"sessions/{session_id}"+resource.suffix, func(w http.ResponseWriter, req *http.Request) {
				if len(req.URL.Query()) > 0 {
					accessError(w, access.ErrInvalid)
					return
				}
				v, e := service.Get(req.Context(), cookie(req, sessionCookie), chi.URLParam(req, "tenant_id"), requestmeta.ID(req.Context()), resource.kind, chi.URLParam(req, "session_id"))
				if e != nil {
					trainingError(w, e)
					return
				}
				respond(w, 200, v)
			})
		}
		type route struct {
			method, path, kind, target, sub string
			status                          int
		}
		for _, v := range []route{
			{"POST", "venues", "createVenue", "", "", 201}, {"PUT", "venues/{venue_id}", "updateVenue", "venue_id", "", 200}, {"POST", "venues/{venue_id}/archive", "archiveVenue", "venue_id", "", 200},
			{"POST", "disciplines", "createDiscipline", "", "", 201}, {"PUT", "disciplines/{discipline_id}", "updateDiscipline", "discipline_id", "", 200}, {"POST", "disciplines/{discipline_id}/archive", "archiveDiscipline", "discipline_id", "", 200},
			{"POST", "groups", "createGroup", "", "", 201}, {"PUT", "groups/{group_id}", "updateGroup", "group_id", "", 200}, {"POST", "groups/{group_id}/archive", "archiveGroup", "group_id", "", 200},
			{"POST", "groups/{group_id}/enrollments", "createEnrollment", "group_id", "", 201}, {"POST", "groups/{group_id}/enrollments/{enrollment_id}/end", "endEnrollment", "group_id", "enrollment_id", 200},
			{"POST", "groups/{group_id}/coaches", "createGroupCoach", "group_id", "", 201}, {"POST", "groups/{group_id}/coaches/{group_coach_id}/end", "endGroupCoach", "group_id", "group_coach_id", 200},
			{"POST", "sessions", "createManualSession", "", "", 201}, {"PUT", "sessions/{session_id}/coaches", "setSessionCoaches", "session_id", "", 200},
			{"POST", "sessions/{session_id}/roster", "addKnownRosterAthlete", "session_id", "", 200}, {"POST", "sessions/{session_id}/roster/{athlete_id}/exclude", "excludeRosterAthlete", "session_id", "athlete_id", 200},
		} {
			r.MethodFunc(v.method, root+v.path, func(w http.ResponseWriter, req *http.Request) {
				if req.Header.Get("X-CSRF-Token") == "" {
					accessError(w, access.ErrForbidden)
					return
				}
				if len(req.URL.Query()) > 0 {
					accessError(w, access.ErrInvalid)
					return
				}
				var raw json.RawMessage
				if !body(w, req, &raw) {
					return
				}
				command, e := training.Decode(v.kind, raw)
				if e != nil {
					accessError(w, e)
					return
				}
				result, replayed, e := service.Command(req.Context(), cookie(req, sessionCookie), req.Header.Get("X-CSRF-Token"), chi.URLParam(req, "tenant_id"), requestmeta.ID(req.Context()), v.kind, chi.URLParam(req, v.target), chi.URLParam(req, v.sub), command)
				// Even terminal conflicts preserve their replay status. Authentication/CSRF
				// failures have no accepted effect, but the header never grants access.
				w.Header().Set("Operation-Replayed", strconv.FormatBool(replayed))
				if e != nil {
					trainingError(w, e)
					return
				}
				respond(w, v.status, result)
			})
		}
	})
}
