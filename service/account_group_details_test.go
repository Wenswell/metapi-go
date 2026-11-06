package service

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/deliciousbuding/metapi-go/config"
)

func TestAccountGroupSnapshotRefresh(t *testing.T) {
	db := openTestDB(t)
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
	site := createTestSite(t, db, "groups", server.URL, "new-api")
	account := createTestAccount(t, db, site, strPtr("groups-user"), "synthetic-session")
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
