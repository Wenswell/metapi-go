package platform

import (
	"context"
	"fmt"
	"strings"
)

// AccountGroupDetail keeps the account-visible pricing and capabilities.
// Group membership can differ between accounts on the same site.
type AccountGroupDetail struct {
	ID           string   `json:"id"`
	Name         string   `json:"name"`
	Description  string   `json:"description"`
	Platform     string   `json:"platform"`
	Rate         *float64 `json:"rate"`
	ImagePrice1K *float64 `json:"imagePrice1k"`
	ImagePrice2K *float64 `json:"imagePrice2k"`
	Video        bool     `json:"video"`
}

// FetchAccountGroupDetails extends name-only token group discovery with the
// fields shown by Relay Groups. No token creation or routing mutation occurs.
func FetchAccountGroupDetails(ctx context.Context, baseURL, family, token string, userID *int, proxy *ProxyConfig) ([]AccountGroupDetail, error) {
	endpoint := ""
	headers := authBearerHeaders(token)
	switch family {
	case "new-api":
		endpoint = "/api/user/self/groups"
		if userID != nil {
			headers["New-Api-User"] = fmt.Sprint(*userID)
		}
	case "sub2api":
		endpoint = "/api/v1/groups/available"
	default:
		return nil, fmt.Errorf("group details are not supported for %s", family)
	}
	payload, err := fetchJSON(ctx, strings.TrimRight(baseURL, "/")+endpoint, "GET", nil, headers, proxy)
	if err != nil {
		return nil, err
	}
	if success, ok := payload["success"].(bool); ok && !success {
		return nil, fmt.Errorf("groups: %v", payload["message"])
	}
	if code, ok := payload["code"]; ok && code != float64(0) {
		return nil, fmt.Errorf("groups: %v", payload["message"])
	}
	var items []map[string]any
	switch data := payload["data"].(type) {
	case []any:
		for _, item := range data {
			row, ok := item.(map[string]any)
			if !ok {
				return nil, fmt.Errorf("invalid group entry")
			}
			items = append(items, row)
		}
	case map[string]any:
		if family != "new-api" {
			return nil, fmt.Errorf("groups response must contain an array")
		}
		for name, value := range data {
			row, ok := value.(map[string]any)
			if !ok {
				return nil, fmt.Errorf("invalid group %s", name)
			}
			if row["name"] == nil {
				row["name"] = name
			}
			items = append(items, row)
		}
	default:
		return nil, fmt.Errorf("groups response is missing valid data")
	}
	groups := make([]AccountGroupDetail, 0, len(items))
	for _, item := range items {
		name, _ := item["name"].(string)
		if strings.TrimSpace(name) == "" {
			return nil, fmt.Errorf("group name is missing")
		}
		id := name
		if value, ok := item["id"]; ok {
			id = fmt.Sprint(value)
		}
		description, _ := item["description"].(string)
		if description == "" {
			description, _ = item["desc"].(string)
		}
		rate := groupNumber(item, "rate_multiplier")
		if rate == nil {
			rate = groupNumber(item, "ratio")
		}
		groupPlatform, _ := item["platform"].(string)
		groups = append(groups, AccountGroupDetail{
			ID: id, Name: name, Description: description, Platform: groupPlatform, Rate: rate,
			ImagePrice1K: groupNumber(item, "image_price_1k"), ImagePrice2K: groupNumber(item, "image_price_2k"),
			Video: item["video_rate_independent"] == true || groupNumber(item, "video_price_480p") != nil || groupNumber(item, "video_price_720p") != nil || groupNumber(item, "video_price_1080p") != nil,
		})
	}
	return groups, nil
}

func groupNumber(item map[string]any, key string) *float64 {
	if n, ok := item[key].(float64); ok {
		return &n
	}
	return nil
}
