package service

import (
	"context"
	"fmt"
	"github.com/deliciousbuding/metapi-go/internal/pgtest"
	"github.com/deliciousbuding/metapi-go/store"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/deliciousbuding/metapi-go/config"
)

func TestAccountGroupSnapshotRefresh(t *testing.T) {
	db := openTestDB(t)
	testAccountGroupSnapshotRefresh(t, db)
}
func TestAccountGroupSnapshotRefreshPostgres(t *testing.T) {
	dsn := os.Getenv("PG_TEST_DSN")
	if dsn == "" {
		t.Skip("PG_TEST_DSN not set")
	}
	db, err := store.Open(store.DialectPostgres, dsn, false)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	pgtest.Reset(t, db.DB)
	if err = store.AutoMigrate(db); err != nil {
		t.Fatal(err)
	}
	testAccountGroupSnapshotRefresh(t, db)
}
func testAccountGroupSnapshotRefresh(t *testing.T, db *store.DB) {
	var fail atomic.Bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if fail.Load() {
			w.WriteHeader(401)
			fmt.Fprint(w, `{"message":"synthetic-session rejected"}`)
			return
		}
		fmt.Fprint(w, `{"success":true,"data":{"public":{"ratio":1}}}`)
	}))
	defer server.Close()
	var site, account int64
	if err := db.Get(&site, db.Rebind(`INSERT INTO sites(name,url,platform,created_at,updated_at) VALUES (?,?,?,'2026-11-06','2026-11-06') RETURNING id`), "groups", server.URL, "new-api"); err != nil {
		t.Fatal(err)
	}
	if err := db.Get(&account, db.Rebind(`INSERT INTO accounts(site_id,username,access_token,status,created_at,updated_at) VALUES (?,?,?,'active','2026-11-06','2026-11-06') RETURNING id`), site, "groups-user", "synthetic-session"); err != nil {
		t.Fatal(err)
	}
	if err := RefreshAccountGroupDetails(context.Background(), db.DB, &config.Config{}, account); err != nil {
		t.Fatal(err)
	}
	fail.Store(true)
	if err := RefreshAccountGroupDetails(context.Background(), db.DB, &config.Config{}, account); err == nil || strings.Contains(err.Error(), "synthetic-session") {
		t.Fatalf("expected sanitized error: %v", err)
	}
	snapshots, err := ListAccountGroupSnapshots(db.DB)
	if err != nil || len(snapshots) != 1 {
		t.Fatalf("snapshots=%v err=%v", snapshots, err)
	}
	row := snapshots[0]
	if len(row.Groups) != 1 || row.FetchedAt == "" || !strings.Contains(row.Error, "[redacted]") {
		t.Fatalf("snapshot lost successful data or error: %+v", row)
	}
	if _, err := db.Exec(db.Rebind("DELETE FROM accounts WHERE id=?"), account); err != nil {
		t.Fatal(err)
	}
	snapshots, err = ListAccountGroupSnapshots(db.DB)
	if err != nil || len(snapshots) != 0 {
		t.Fatalf("orphan snapshots=%v err=%v", snapshots, err)
	}
}
