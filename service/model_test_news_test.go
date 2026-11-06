package service

import (
	"context"
	"strings"
	"testing"
	"time"
)

func TestModelTestNewsParsers(t *testing.T) {
	rss := `<rss version="2.0"><channel><title>News</title><item><title>Headline</title><description>&lt;b&gt;Summary&lt;/b&gt;</description><pubDate>Fri, 06 Nov 2026 12:00:00 GMT</pubDate></item></channel></rss>`
	items, err := parseModelTestNews("rss", []byte(rss))
	if err != nil || len(items) != 1 || items[0].summary != "Summary" {
		t.Fatalf("rss: %v %v", items, err)
	}
	atom := `<feed xmlns="http://www.w3.org/2005/Atom"><title>News</title><entry><title>Atom headline</title><summary>Atom summary</summary></entry></feed>`
	if items, err = parseModelTestNews("rss", []byte(atom)); err != nil || len(items) != 1 {
		t.Fatalf("atom: %v %v", items, err)
	}
	payload := `{"results":[{"title":"Space news","summary":"<p>Summary</p>","published_at":"2026-11-06T12:00:00Z"}]}`
	items, err = parseModelTestNews("spaceflight", []byte(payload))
	if err != nil || len(items) != 1 || items[0].title != "Space news" {
		t.Fatalf("spaceflight: %v %v", items, err)
	}
	digest := buildModelTestNewsDigest(items, time.Date(2026, 11, 6, 13, 0, 0, 0, time.UTC))
	if digest != "1. Space news — Summary" {
		t.Fatal(digest)
	}
	for _, bad := range []string{`{}`, `{"results":[{"title":"x"}]}`, `{"results":[]}`} {
		if _, err := parseModelTestNews("spaceflight", []byte(bad)); err == nil {
			t.Fatalf("accepted %s", bad)
		}
	}
}

func TestResolveModelTestNews(t *testing.T) {
	plan := DefaultModelTestPlan()
	plan.TextPrompts = []string{"plain"}
	plan.NewsSource = ""
	if _, err := resolveModelTestNews(context.Background(), plan); err != nil {
		t.Fatal(err)
	}
	plan.TextPrompts = []string{"Summarize {NEWS-TODAY}"}
	if _, err := resolveModelTestNews(context.Background(), plan); err == nil {
		t.Fatal("missing source accepted")
	}
	modelTestNewsCache.Lock()
	oldDay, oldSource, oldDigest := modelTestNewsCache.day, modelTestNewsCache.source, modelTestNewsCache.digest
	modelTestNewsCache.day = time.Now().UTC().Add(8 * time.Hour).Format("2006-01-02")
	modelTestNewsCache.source = "rss"
	modelTestNewsCache.digest = "Synthetic headline"
	modelTestNewsCache.Unlock()
	defer func() {
		modelTestNewsCache.Lock()
		defer modelTestNewsCache.Unlock()
		modelTestNewsCache.day, modelTestNewsCache.source, modelTestNewsCache.digest = oldDay, oldSource, oldDigest
	}()
	plan.NewsSource = "rss"
	plan.SystemPrompt = "News: {NEWS-TODAY}"
	resolved, err := resolveModelTestNews(context.Background(), plan)
	if err != nil || !strings.Contains(resolved.SystemPrompt, "Synthetic headline") || strings.Contains(resolved.TextPrompts[0], "{NEWS-TODAY}") {
		t.Fatalf("%v %v", resolved, err)
	}
	if plan.TextPrompts[0] != "Summarize {NEWS-TODAY}" {
		t.Fatal("mutated saved plan")
	}
}
