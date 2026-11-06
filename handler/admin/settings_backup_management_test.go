package admin

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/deliciousbuding/metapi-go/service"
	"github.com/deliciousbuding/metapi-go/store"
)

func TestManagementBackupRoundTrip(t *testing.T) {
	t.Run("sqlite", func(t *testing.T) { runManagementBackupRoundTrip(t, setupBackupTestDB(t)) })
	t.Run("postgres", func(t *testing.T) { runManagementBackupRoundTrip(t, setupBackupPostgresTestDB(t)) })
}

func runManagementBackupRoundTrip(t *testing.T, db *store.DB) {
	t.Helper()
	siteID := insertBackupFixtureID(t, db, `INSERT INTO sites (name,url,platform,tags) VALUES (?,?,'new-api',?)`, "synthetic-backup", "https://backup.example.com", `["公益"]`)
	accountID := insertBackupFixtureID(t, db, `INSERT INTO accounts (site_id,username,access_token) VALUES (?,?,'synthetic-token')`, siteID, "synthetic-user")
	groups := `[{"name":"synthetic-group","ratio":0.5}]`
	execBackupFixture(t, db, `INSERT INTO account_group_snapshots (account_id,groups_json,fetched_at,attempted_at,error) VALUES (?,?,?,?,'')`, accountID, groups, "2026-11-06T00:00:00Z", "2026-11-06T00:00:00Z")
	plan := service.DefaultModelTestPlan()
	plan.Targets = []service.ModelTestTarget{{AccountID: accountID, Model: "synthetic-model", Type: "image"}}
	plan.SystemPrompt = "synthetic system {NEWS-TODAY}"
	plan.VideoSystemPrompt = "synthetic video system"
	plan.CodexSystemPrompt = "synthetic developer instruction"
	plan.NewsSource = "spaceflight"
	plan.ScheduleEnabled = true
	plan.ImageMedia = "data:image/png;base64," + base64.StdEncoding.EncodeToString([]byte(strings.Repeat("i", 3<<20)))
	plan.VideoMedia = "data:video/mp4;base64," + base64.StdEncoding.EncodeToString([]byte(strings.Repeat("v", 3<<20)))
	rawPlan, err := json.Marshal(plan)
	if err != nil {
		t.Fatal(err)
	}
	execBackupFixture(t, db, `INSERT INTO settings (key,value) VALUES ('model_test_plan',?)`, string(rawPlan))
	detail, err := json.Marshal(map[string]any{"input": map[string]string{"media": plan.ImageMedia, "systemPrompt": plan.SystemPrompt}})
	if err != nil {
		t.Fatal(err)
	}
	execBackupFixture(t, db, `INSERT INTO model_test_results (id,batch_id,account_id,site_id,site_name,account_name,model,type,source,status,created_at,latency_ms,text,error,detail) VALUES ('synthetic-result','synthetic-batch',?,?,'synthetic-backup','synthetic-user','synthetic-model','image','manual','passed','2026-11-06T00:00:00Z',1,'ok','',?)`, accountID, siteID, string(detail))
	for _, scope := range []string{"all", "preferences", "accounts"} {
		payload, err := buildBackupPayload(db.DB, scope)
		if err != nil {
			t.Fatal(err)
		}
		tables := payload["tables"].(map[string]any)
		if scope == "accounts" {
			if tables["account_group_snapshots"] != nil || tables["model_test_results"] != nil || tables["settings"] != nil {
				t.Fatal("account scope unexpectedly contains testing preferences")
			}
			if tables["sites"].([]map[string]any)[0]["tags"] != `["公益"]` {
				t.Fatal("account export lost tags")
			}
			continue
		}
		rows := tables["settings"].([]map[string]any)
		if len(rows) != 1 || rows[0]["value"] != string(rawPlan) {
			t.Fatal("test plan was truncated or changed")
		}
		if scope == "preferences" {
			continue
		}
		raw, err := json.Marshal(payload)
		if err != nil {
			t.Fatal(err)
		}
		if len(raw) > int(backupWebdavImportMaxBytes) {
			t.Fatal("fixture exceeds complete import limit")
		}
		body, err := decodeBackupImportBodyFrom(raw)
		if err != nil {
			t.Fatal(err)
		}
		preview, err := previewBackupImportTables(db.DB, body)
		if err != nil {
			t.Fatal(err)
		}
		if preview["account_group_snapshots"].Duplicates != 1 {
			t.Fatalf("snapshot conflict missing: %+v", preview["account_group_snapshots"])
		}
		for _, table := range store.ClearTableNames() {
			if _, err := db.Exec(fmt.Sprintf(`DELETE FROM %q`, table)); err != nil {
				t.Fatal(err)
			}
		}
		if _, err := importBackupTables(db.DB, body, true); err != nil {
			t.Fatal(err)
		}
		restored, err := service.LoadModelTestPlan(db.DB)
		if err != nil {
			t.Fatal(err)
		}
		restoredJSON, err := json.Marshal(restored)
		if err != nil {
			t.Fatal(err)
		}
		if string(restoredJSON) != string(rawPlan) {
			t.Fatal("restored plan differs")
		}
		for _, check := range []struct {
			query string
			want  string
		}{
			{`SELECT tags FROM sites`, `["公益"]`},
			{`SELECT groups_json FROM account_group_snapshots`, groups},
			{`SELECT detail FROM model_test_results`, string(detail)},
		} {
			var got string
			if err := db.Get(&got, check.query); err != nil {
				t.Fatal(err)
			}
			if got != check.want {
				t.Fatalf("restored data differs for %s", check.query)
			}
		}
	}
}
