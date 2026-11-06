package service

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/mmcdole/gofeed"
	"golang.org/x/net/html"
)

const modelTestNewsPlaceholder = "{NEWS-TODAY}"

var modelTestNewsSources = map[string]string{
	"rss":         "https://hnrss.org/frontpage",
	"spaceflight": "https://api.spaceflightnewsapi.net/v4/articles/?limit=20",
}
var modelTestNewsCache = struct {
	sync.Mutex
	day, source, digest string
}{}

type modelTestNewsItem struct {
	title, summary string
	published      time.Time
}

func plainNewsText(value string) string {
	tokenizer := html.NewTokenizer(strings.NewReader(value))
	parts := []string{}
	for {
		kind := tokenizer.Next()
		if kind == html.ErrorToken {
			break
		}
		if kind == html.TextToken {
			parts = append(parts, string(tokenizer.Text()))
		}
	}
	return strings.Join(strings.Fields(strings.Join(parts, " ")), " ")
}

func parseModelTestNews(source string, data []byte) ([]modelTestNewsItem, error) {
	items := []modelTestNewsItem{}
	switch source {
	case "rss":
		feed, err := gofeed.NewParser().ParseString(string(data))
		if err != nil {
			return nil, fmt.Errorf("invalid RSS/Atom feed: %w", err)
		}
		for _, item := range feed.Items {
			published := time.Time{}
			if item.PublishedParsed != nil {
				published = *item.PublishedParsed
			} else if item.UpdatedParsed != nil {
				published = *item.UpdatedParsed
			}
			items = append(items, modelTestNewsItem{plainNewsText(item.Title), plainNewsText(item.Description), published})
		}
	case "spaceflight":
		var payload struct {
			Results *[]struct {
				Title       *string `json:"title"`
				Summary     *string `json:"summary"`
				PublishedAt string  `json:"published_at"`
			} `json:"results"`
		}
		if err := json.Unmarshal(data, &payload); err != nil {
			return nil, fmt.Errorf("invalid Spaceflight JSON: %w", err)
		}
		if payload.Results == nil {
			return nil, fmt.Errorf("Spaceflight requires results")
		}
		for _, item := range *payload.Results {
			published, err := time.Parse(time.RFC3339, item.PublishedAt)
			if item.Title == nil || strings.TrimSpace(*item.Title) == "" || item.Summary == nil || err != nil {
				return nil, fmt.Errorf("invalid Spaceflight article fields")
			}
			items = append(items, modelTestNewsItem{plainNewsText(*item.Title), plainNewsText(*item.Summary), published})
		}
	default:
		return nil, fmt.Errorf("invalid news source")
	}
	usable := items[:0]
	for _, item := range items {
		if item.title != "" {
			usable = append(usable, item)
		}
	}
	if len(usable) == 0 {
		return nil, fmt.Errorf("news source returned no usable articles")
	}
	return usable, nil
}

func buildModelTestNewsDigest(items []modelTestNewsItem, now time.Time) string {
	if len(items) > 20 {
		items = items[:20]
	}
	chosen := []modelTestNewsItem{}
	for _, item := range items {
		if !item.published.IsZero() && !item.published.Before(now.Add(-24*time.Hour)) {
			chosen = append(chosen, item)
		}
	}
	if len(chosen) < 10 {
		chosen = items[:min(10, len(items))]
	}
	lines := []string{}
	for i, item := range chosen {
		words := strings.Fields(item.summary)
		if len(words) > 200 {
			words = words[:200]
		}
		summary := strings.Join(words, " ")
		// Bound scripts without whitespace as well.
		if len([]rune(summary)) > 1200 {
			summary = string([]rune(summary)[:1200]) + "…"
		}
		line := fmt.Sprintf("%d. %s", i+1, item.title)
		if summary != "" {
			line += " — " + summary
		}
		lines = append(lines, line)
	}
	return strings.Join(lines, "\n")
}

func LoadModelTestNews(ctx context.Context, source string) (string, error) {
	url, ok := modelTestNewsSources[source]
	if !ok {
		return "", fmt.Errorf("choose a news source before using %s", modelTestNewsPlaceholder)
	}
	modelTestNewsCache.Lock()
	defer modelTestNewsCache.Unlock()
	day := time.Now().UTC().Add(8 * time.Hour).Format("2006-01-02")
	if modelTestNewsCache.source == source && modelTestNewsCache.day == day {
		return modelTestNewsCache.digest, nil
	}
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", err
	}
	response, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("news source request failed: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return "", fmt.Errorf("news source returned HTTP %d", response.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, (2<<20)+1))
	if err != nil {
		return "", err
	}
	if len(data) > 2<<20 {
		return "", fmt.Errorf("news response exceeds 2 MiB")
	}
	items, err := parseModelTestNews(source, data)
	if err != nil {
		return "", err
	}
	digest := buildModelTestNewsDigest(items, time.Now())
	modelTestNewsCache.day, modelTestNewsCache.source, modelTestNewsCache.digest = day, source, digest
	return digest, nil
}

func resolveModelTestNews(ctx context.Context, plan ModelTestPlan) (ModelTestPlan, error) {
	values := []*string{&plan.SystemPrompt, &plan.VideoSystemPrompt, &plan.CodexSystemPrompt, &plan.ImagePrompt, &plan.VideoPrompt, &plan.CodexPrompt, &plan.SearchPrompt}
	plan.TextPrompts = append([]string{}, plan.TextPrompts...)
	for i := range plan.TextPrompts {
		values = append(values, &plan.TextPrompts[i])
	}
	needed := false
	for _, value := range values {
		needed = needed || strings.Contains(*value, modelTestNewsPlaceholder)
	}
	if !needed {
		return plan, nil
	}
	digest, err := LoadModelTestNews(ctx, plan.NewsSource)
	if err != nil {
		return plan, err
	}
	for _, value := range values {
		*value = strings.ReplaceAll(*value, modelTestNewsPlaceholder, digest)
	}
	return plan, nil
}
