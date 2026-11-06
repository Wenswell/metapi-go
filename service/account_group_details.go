package service

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/deliciousbuding/metapi-go/config"
	"github.com/deliciousbuding/metapi-go/platform"
	"github.com/jmoiron/sqlx"
)

type AccountGroupSnapshot struct {
	AccountID   int64                         `json:"accountId" db:"account_id"`
	GroupsJSON  string                        `json:"-" db:"groups_json"`
	Groups      []platform.AccountGroupDetail `json:"groups"`
	FetchedAt   string                        `json:"fetchedAt" db:"fetched_at"`
	AttemptedAt string                        `json:"attemptedAt" db:"attempted_at"`
	Error       string                        `json:"error" db:"error"`
}

func ListAccountGroupSnapshots(db *sqlx.DB) ([]AccountGroupSnapshot, error) {
	rows := []AccountGroupSnapshot{}
	if err := db.Select(&rows, "SELECT * FROM account_group_snapshots ORDER BY account_id"); err != nil {
		return nil, err
	}
	for i := range rows {
		if err := json.Unmarshal([]byte(rows[i].GroupsJSON), &rows[i].Groups); err != nil {
			return nil, fmt.Errorf("group snapshot %d: %w", rows[i].AccountID, err)
		}
	}
	return rows, nil
}

func RefreshAccountGroupDetails(ctx context.Context, db *sqlx.DB, cfg *config.Config, accountID int64) error {
	row, err := GetAccountWithSiteByID(db, accountID)
	if err != nil {
		return err
	}
	var groups []platform.AccountGroupDetail
	switch {
	case row.Account.Status != "active" || row.Site.Status == "disabled":
		err = fmt.Errorf("account or site is disabled")
	case IsAPIKeyConnection(&row.Account) || strings.TrimSpace(row.Account.AccessToken) == "":
		err = fmt.Errorf("a session access token is required to query groups")
	default:
		groups, err = platform.FetchAccountGroupDetails(ctx, row.Site.URL, row.Site.Platform, row.Account.AccessToken, ResolvePlatformUserIDPtr(&row.Account), BuildPlatformProxyConfig(cfg, &row.Account, &row.Site))
	}
	now := time.Now().UTC().Format(time.RFC3339)
	if err != nil {
		message := err.Error()
		if row.Account.AccessToken != "" {
			message = strings.ReplaceAll(message, row.Account.AccessToken, "[redacted]")
		}
		_, saveErr := db.Exec(db.Rebind(`INSERT INTO account_group_snapshots (account_id, attempted_at, error) VALUES (?, ?, ?)
   ON CONFLICT(account_id) DO UPDATE SET attempted_at=excluded.attempted_at, error=excluded.error`), accountID, now, message)
		if saveErr != nil {
			return saveErr
		}
		return fmt.Errorf("%s", message)
	}
	encoded, err := json.Marshal(groups)
	if err != nil {
		return err
	}
	_, err = db.Exec(db.Rebind(`INSERT INTO account_group_snapshots (account_id,groups_json,fetched_at,attempted_at,error) VALUES (?,?,?,?,'')
  ON CONFLICT(account_id) DO UPDATE SET groups_json=excluded.groups_json, fetched_at=excluded.fetched_at, attempted_at=excluded.attempted_at,error=''`), accountID, string(encoded), now, now)
	return err
}
