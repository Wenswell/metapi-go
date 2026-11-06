package platform

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestAccountGroupDetailsProtocols(t *testing.T) {
	for _, tc := range []struct{ family, path, body string }{
		{"new-api", "/api/user/self/groups", `{"success":true,"data":{"public":{"ratio":0.5,"desc":"shared"}}}`},
		{"sub2api", "/api/v1/groups/available", `{"code":0,"data":[{"id":7,"name":"pro","description":"paid","rate_multiplier":2,"platform":"openai","image_price_2k":0.2,"video_price_720p":0.1}]}`},
	} {
		t.Run(tc.family, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != tc.path || r.Header.Get("Authorization") != "Bearer synthetic-session" {
					t.Errorf("bad request %s, authorization present=%v", r.URL.Path, r.Header.Get("Authorization") != "")
				}
				if tc.family == "new-api" && r.Header.Get("New-Api-User") != "42" {
					t.Error("missing upstream user ID")
				}
				fmt.Fprint(w, tc.body)
			}))
			defer server.Close()
			userID := 42
			groups, err := FetchAccountGroupDetails(context.Background(), server.URL, tc.family, "synthetic-session", &userID, nil)
			if err != nil || len(groups) != 1 {
				t.Fatalf("groups=%v err=%v", groups, err)
			}
			group := groups[0]
			if tc.family == "new-api" && (group.Name != "public" || group.Rate == nil || *group.Rate != 0.5 || group.Description != "shared") {
				t.Fatalf("group=%+v", group)
			}
			if tc.family == "sub2api" && (group.ID != "7" || group.ImagePrice2K == nil || !group.Video || *group.Rate != 2) {
				t.Fatalf("group=%+v", group)
			}
		})
	}
	for _, body := range []string{`{"code":1,"message":"denied"}`, `{"success":true}`, `{"data":["invalid"]}`} {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, body) }))
		_, err := FetchAccountGroupDetails(context.Background(), server.URL, "sub2api", "synthetic", nil, nil)
		server.Close()
		if err == nil {
			t.Fatalf("invalid payload accepted: %s", body)
		}
	}
}
