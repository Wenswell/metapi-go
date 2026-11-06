package service

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/deliciousbuding/metapi-go/config"
	"github.com/deliciousbuding/metapi-go/internal/pgtest"
	"github.com/deliciousbuding/metapi-go/internal/sqlitetest"
	"github.com/deliciousbuding/metapi-go/store"
)

func TestModelTestingPersistence(t *testing.T) {
	for _, dialect := range []string{store.DialectSQLite, store.DialectPostgres} {
		t.Run(dialect, func(t *testing.T) {
			var db *store.DB
			if dialect == store.DialectSQLite {
				db = sqlitetest.Open(t)
			} else {
				dsn := os.Getenv("PG_TEST_DSN")
				if dsn == "" {
					t.Skip("PG_TEST_DSN not set")
				}
				var err error
				db, err = store.Open(dialect, dsn, false)
				if err != nil {
					t.Fatal(err)
				}
				defer db.Close()
				pgtest.Reset(t, db.DB)
				if err = store.AutoMigrate(db); err != nil {
					t.Fatal(err)
				}
			}
			calls := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				if r.Header.Get("Authorization") != "Bearer synthetic-api" {
					t.Error("management token used instead of API token")
				}
				if calls == 2 {
					w.WriteHeader(429)
					fmt.Fprint(w, `{"error":"synthetic-api quota"}`)
					return
				}
				fmt.Fprint(w, `{"choices":[{"message":{"content":"synthetic-api ok"}}],"usage":{"completion_tokens":2}}`)
			}))
			defer server.Close()
			var site, account, missing int64
			if err := db.Get(&site, db.Rebind(`INSERT INTO sites(name,url,platform,tags,created_at,updated_at) VALUES (?,?,?,?,'2026-11-06T00:00:00Z','2026-11-06T00:00:00Z') RETURNING id`), "testsite", server.URL, "new-api", `["公益"]`); err != nil {
				t.Fatal(err)
			}
			if err := db.Get(&account, db.Rebind(`INSERT INTO accounts(site_id,username,access_token,api_token,status,created_at,updated_at) VALUES (?,?,?,?,?,'2026-11-06T00:00:00Z','2026-11-06T00:00:00Z') RETURNING id`), site, "tester", "synthetic-session", "synthetic-api", "active"); err != nil {
				t.Fatal(err)
			}
			if err := db.Get(&missing, db.Rebind(`INSERT INTO accounts(site_id,username,access_token,status,created_at,updated_at) VALUES (?,?,?,?,'2026-11-06T00:00:00Z','2026-11-06T00:00:00Z') RETURNING id`), site, "no-api", "synthetic-session", "active"); err != nil {
				t.Fatal(err)
			}
			plan := DefaultModelTestPlan()
			plan.TextPrompts = []string{"first", "second", "third"}
			plan.Targets = []ModelTestTarget{{account, "test-model", "text"}, {missing, "test-model", "text"}}
			if err := SaveModelTestPlan(db.DB, plan); err != nil {
				t.Fatal(err)
			}
			loaded, err := LoadModelTestPlan(db.DB)
			if err != nil || len(loaded.Targets) != 2 {
				t.Fatalf("loaded=%+v err=%v", loaded, err)
			}
			batch, err := RunModelTests(context.Background(), db.DB, &config.Config{}, loaded, "manual")
			if err != nil {
				t.Fatal(err)
			}
			history, err := ListModelTestHistory(db.DB, ModelTestHistoryFilter{SiteTag: "公益", Status: "partial", Page: 1, PageSize: 1, BatchID: batch})
			if err != nil {
				t.Fatal(err)
			}
			if history["total"] != 1 {
				var rows []ModelTestResult
				_ = db.Select(&rows, "SELECT * FROM model_test_results")
				t.Fatalf("history=%+v rows=%+v", history, rows)
			}
			result := history["items"].([]ModelTestResult)[0]
			if strings.Contains(result.Text, "synthetic-api") || strings.Contains(result.Error, "synthetic-api") || !strings.Contains(result.Text, "[redacted]") {
				t.Fatalf("secret exposed in result: %+v", result)
			}
			var detail string
			if err := db.Get(&detail, db.Rebind("SELECT detail FROM model_test_results WHERE id=?"), result.ID); err != nil {
				t.Fatal(err)
			}
			if strings.Contains(detail, "synthetic-api") || !strings.Contains(detail, "third") {
				t.Fatalf("bad history detail")
			}
			history, err = ListModelTestHistory(db.DB, ModelTestHistoryFilter{Query: "no-api", Page: 1, PageSize: 50})
			if err != nil || history["total"] != 1 {
				t.Fatalf("query: %+v %v", history, err)
			}
			if calls != 2 {
				t.Fatalf("missing credential sent upstream, calls=%d", calls)
			}
			history, err = ListModelTestHistory(db.DB, ModelTestHistoryFilter{SiteTag: "付费", Page: 1, PageSize: 50})
			if err != nil || history["total"] != 0 {
				t.Fatalf("tag filtering: %+v %v", history, err)
			}
		})
	}
}
func TestModelTestingScheduleAndValidation(t *testing.T) {
	plan := DefaultModelTestPlan()
	plan.ScheduleEnabled = true
	plan.Targets = []ModelTestTarget{{1, "test", "text"}}
	now := time.Date(2026, 11, 6, 1, 0, 0, 0, time.UTC)
	if !ModelTestPlanDue(plan, now) || ModelTestPlanDue(plan, now.Add(time.Minute)) {
		t.Fatal("schedule ignored timezone or minute")
	}
	db := sqlitetest.Open(t)
	for i, want := range []bool{true, false, true} {
		when := now
		if i == 2 {
			when = when.Add(time.Minute)
		}
		got, err := ClaimModelTestMinute(db.DB, when)
		if err != nil || got != want {
			t.Fatalf("claim %d: %v %v", i, got, err)
		}
	}
	plan.Targets = append(plan.Targets, plan.Targets[0])
	if plan.Validate() == nil {
		t.Fatal("duplicate target accepted")
	}
	plan.Targets = []ModelTestTarget{{1, "test", "image"}}
	if plan.Validate() == nil {
		t.Fatal("missing image accepted")
	}
	plan.ImageMedia = "data:image/png;base64,aGk="
	if err := plan.Validate(); err != nil {
		t.Fatal(err)
	}
	plan.Timezone = "invalid-timezone"
	if plan.Validate() == nil {
		t.Fatal("invalid timezone accepted")
	}
}
