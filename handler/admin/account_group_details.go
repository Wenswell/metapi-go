package admin

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/deliciousbuding/metapi-go/config"
	"github.com/deliciousbuding/metapi-go/service"
	"github.com/go-chi/chi/v5"
	"github.com/jmoiron/sqlx"
)

func RegisterAccountGroupDetailsRoutes(r chi.Router, db *sqlx.DB, cfg *config.Config) {
	r.Get("/api/account-groups", func(w http.ResponseWriter, r *http.Request) {
		rows, err := service.ListAccountGroupSnapshots(db)
		if err != nil {
			writeError(w, 500, err.Error())
			return
		}
		writeJSON(w, 200, rows)
	})
	r.Post("/api/account-groups/refresh", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			AccountIDs []int64 `json:"accountIds"`
		}
		if err := decodeJSONRequest(r, &body); err != nil || len(body.AccountIDs) == 0 {
			writeError(w, 400, "accountIds must be a non-empty array")
			return
		}
		ids := make([]int64, 0, len(body.AccountIDs))
		seen := map[int64]bool{}
		for _, id := range body.AccountIDs {
			if id <= 0 {
				writeError(w, 400, "invalid account ID")
				return
			}
			if !seen[id] {
				ids = append(ids, id)
				seen[id] = true
			}
		}
		task, reused := StartBackgroundTask(BackgroundTaskStartOptions{Type: "account-groups-refresh", Title: "Refresh account groups", DedupeKey: "account-groups-refresh"}, func() (any, error) {
			results := []map[string]any{}
			for _, id := range ids {
				ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
				err := service.RefreshAccountGroupDetails(ctx, db, cfg, id)
				cancel()
				item := map[string]any{"accountId": id, "success": err == nil}
				if err != nil {
					item["error"] = err.Error()
				}
				results = append(results, item)
			}
			return map[string]any{"results": results}, nil
		})
		writeJSON(w, http.StatusAccepted, map[string]any{"taskId": task.ID, "reused": reused, "message": fmt.Sprintf("%d accounts", len(ids))})
	})
}
