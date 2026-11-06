package admin

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/deliciousbuding/metapi-go/config"
	"github.com/deliciousbuding/metapi-go/service"
	"github.com/go-chi/chi/v5"
	"github.com/jmoiron/sqlx"
)

func RegisterModelTestingRoutes(r chi.Router, db *sqlx.DB, cfg *config.Config) {
	r.Get("/api/model-tests/plan", func(w http.ResponseWriter, r *http.Request) {
		plan, err := service.LoadModelTestPlan(db)
		if err != nil {
			writeError(w, 500, err.Error())
			return
		}
		writeJSON(w, 200, plan)
	})
	r.Put("/api/model-tests/plan", func(w http.ResponseWriter, r *http.Request) {
		var plan service.ModelTestPlan
		if err := decodeJSONRequest(r, &plan); err != nil {
			writeError(w, 400, err.Error())
			return
		}
		if err := service.SaveModelTestPlan(db, plan); err != nil {
			writeError(w, 400, err.Error())
			return
		}
		writeJSON(w, 200, map[string]any{"success": true})
	})
	r.Post("/api/model-tests/run", func(w http.ResponseWriter, r *http.Request) {
		plan, err := service.LoadModelTestPlan(db)
		if err != nil {
			writeError(w, 500, err.Error())
			return
		}
		if err := plan.Validate(); err != nil || len(plan.Targets) == 0 {
			writeError(w, 400, "save a valid plan with at least one target first")
			return
		}
		task, reused := StartBackgroundTask(BackgroundTaskStartOptions{Type: "model-tests", Title: "Account model tests", DedupeKey: "model-tests"}, func() (any, error) {
			batch, err := service.RunModelTests(context.Background(), db, cfg, plan, "manual")
			return map[string]any{"batchId": batch}, err
		})
		writeJSON(w, 202, map[string]any{"taskId": task.ID, "reused": reused})
	})
	r.Get("/api/model-tests/history", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		page, _ := strconv.Atoi(q.Get("page"))
		if page < 1 {
			page = 1
		}
		size := 50
		filter := service.ModelTestHistoryFilter{Query: q.Get("q"), Type: q.Get("type"), Status: q.Get("status"), SiteTag: q.Get("siteTag"), BatchID: q.Get("batchId"), Page: page, PageSize: size}
		for _, item := range []struct {
			key  string
			dest *string
			end  bool
		}{{"from", &filter.From, false}, {"to", &filter.To, true}} {
			if value := q.Get(item.key); value != "" {
				day, err := time.Parse("2006-01-02", value)
				if err != nil {
					writeError(w, 400, "dates must use YYYY-MM-DD")
					return
				}
				if item.end {
					day = day.AddDate(0, 0, 1)
				}
				*item.dest = day.Format(time.RFC3339)
			}
		}
		result, err := service.ListModelTestHistory(db, filter)
		if err != nil {
			writeError(w, 500, err.Error())
			return
		}
		writeJSON(w, 200, result)
	})
	r.Get("/api/model-tests/history/{id}", func(w http.ResponseWriter, r *http.Request) {
		var result service.ModelTestResult
		err := db.Get(&result, db.Rebind("SELECT * FROM model_test_results WHERE id=?"), chi.URLParam(r, "id"))
		if errors.Is(err, sql.ErrNoRows) {
			writeError(w, 404, "test result not found")
			return
		}
		if err != nil {
			writeError(w, 500, err.Error())
			return
		}
		writeJSON(w, 200, result)
	})
}
