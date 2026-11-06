package service

import (
	"encoding/json"
	"fmt"
	"github.com/jmoiron/sqlx"
)

// SiteIDsWithTag resolves an exact tag across both supported SQL dialects.
func SiteIDsWithTag(db *sqlx.DB, tag string) ([]int64, error) {
	var rows []struct {
		ID   int64   `db:"id"`
		Tags *string `db:"tags"`
	}
	if err := db.Select(&rows, "SELECT id, tags FROM sites WHERE tags IS NOT NULL AND tags <> ''"); err != nil {
		return nil, err
	}
	ids := []int64{}
	for _, row := range rows {
		var tags []string
		if err := json.Unmarshal([]byte(*row.Tags), &tags); err != nil {
			return nil, fmt.Errorf("invalid tags for site %d: %w", row.ID, err)
		}
		for _, value := range tags {
			if value == tag {
				ids = append(ids, row.ID)
				break
			}
		}
	}
	return ids, nil
}
