package service

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/deliciousbuding/metapi-go/config"
	"github.com/deliciousbuding/metapi-go/platform"
	"github.com/google/uuid"
	"github.com/jmoiron/sqlx"
	"github.com/robfig/cron/v3"
)

const modelTestConfigKey = "model_test_plan"

var modelTestMutex sync.Mutex
var ErrModelTestsBusy = errors.New("model tests are already running")

type ModelTestTarget struct {
	AccountID int64  `json:"accountId"`
	Model     string `json:"model"`
	Type      string `json:"type"`
}
type ModelTestPlan struct {
	SystemPrompt      string `json:"systemPrompt"`
	VideoSystemPrompt string `json:"videoSystemPrompt"`
	CodexSystemPrompt string `json:"codexSystemPrompt"`
	NewsSource        string `json:"newsSource"`

	Targets         []ModelTestTarget `json:"targets"`
	TextPrompts     []string          `json:"textPrompts"`
	ImagePrompt     string            `json:"imagePrompt"`
	VideoPrompt     string            `json:"videoPrompt"`
	CodexPrompt     string            `json:"codexPrompt"`
	SearchPrompt    string            `json:"searchPrompt"`
	ImageMedia      string            `json:"imageMedia"`
	VideoMedia      string            `json:"videoMedia"`
	TimeoutSeconds  int               `json:"timeoutSeconds"`
	MaxOutputTokens int               `json:"maxOutputTokens"`
	ScheduleEnabled bool              `json:"scheduleEnabled"`
	Cron            string            `json:"cron"`
	Timezone        string            `json:"timezone"`
}

func DefaultModelTestPlan() ModelTestPlan {
	return ModelTestPlan{NewsSource: "rss", SystemPrompt: "You are a helpful assistant. Keep replies under 30 words.", Targets: []ModelTestTarget{}, TextPrompts: []string{"Reply with OK."}, ImagePrompt: "Describe this image.", VideoPrompt: "Summarize this video.", CodexPrompt: "Reply with OK.", SearchPrompt: "What is the latest stable Go release?", TimeoutSeconds: 120, MaxOutputTokens: 512, Cron: "0 9 * * *", Timezone: "Asia/Singapore"}
}
func LoadModelTestPlan(db *sqlx.DB) (ModelTestPlan, error) {
	var value string
	err := db.Get(&value, db.Rebind("SELECT value FROM settings WHERE key=?"), modelTestConfigKey)
	if errors.Is(err, sql.ErrNoRows) {
		return DefaultModelTestPlan(), nil
	}
	if err != nil {
		return ModelTestPlan{}, err
	}
	var plan ModelTestPlan
	err = json.Unmarshal([]byte(value), &plan)
	return plan, err
}
func (p ModelTestPlan) Validate() error {
	if len(p.Targets) > 200 {
		return fmt.Errorf("at most 200 targets are allowed")
	}
	if p.TimeoutSeconds < 1 || p.TimeoutSeconds > 600 || p.MaxOutputTokens < 1 || p.MaxOutputTokens > 32768 {
		return fmt.Errorf("timeout must be 1–600 seconds and output limit 1–32768 tokens")
	}
	if len(p.TextPrompts) < 1 || len(p.TextPrompts) > 3 {
		return fmt.Errorf("text tests require 1–3 prompts")
	}
	for _, prompt := range append(append([]string{}, p.TextPrompts...), p.ImagePrompt, p.VideoPrompt, p.CodexPrompt, p.SearchPrompt) {
		if strings.TrimSpace(prompt) == "" || len(prompt) > 16000 {
			return fmt.Errorf("each prompt must contain 1–16000 bytes")
		}
	}
	for _, value := range []string{p.SystemPrompt, p.VideoSystemPrompt, p.CodexSystemPrompt} {
		if len(value) > 16000 {
			return fmt.Errorf("system prompt exceeds 16000 bytes")
		}
	}
	if p.NewsSource != "" {
		if _, ok := modelTestNewsSources[p.NewsSource]; !ok {
			return fmt.Errorf("invalid news source")
		}
	}
	seen := map[ModelTestTarget]bool{}
	for _, target := range p.Targets {
		if target.AccountID <= 0 || strings.TrimSpace(target.Model) == "" || len(target.Model) > 256 {
			return fmt.Errorf("each target requires an account and model")
		}
		switch target.Type {
		case "text", "image", "video", "codex", "search":
		default:
			return fmt.Errorf("invalid test type %s", target.Type)
		}
		if seen[target] {
			return fmt.Errorf("duplicate test target")
		}
		seen[target] = true
		if target.Type == "image" && p.ImageMedia == "" || target.Type == "video" && p.VideoMedia == "" {
			return fmt.Errorf("%s tests require default media", target.Type)
		}
	}
	for _, media := range []struct{ value, kind string }{{p.ImageMedia, "image"}, {p.VideoMedia, "video"}} {
		if media.value == "" {
			continue
		}
		if strings.HasPrefix(media.value, "data:") {
			header, data, ok := strings.Cut(media.value, ",")
			if !ok || !strings.HasPrefix(header, "data:"+media.kind+"/") || !strings.HasSuffix(header, ";base64") {
				return fmt.Errorf("invalid %s data URL", media.kind)
			}
			if decoded, err := base64.StdEncoding.DecodeString(data); err != nil || len(decoded) > 6<<20 {
				return fmt.Errorf("media must be valid base64 and at most 6 MiB")
			}
		} else {
			parsed, err := url.Parse(media.value)
			if err != nil || (parsed.Scheme != "https" && parsed.Scheme != "http") || parsed.Host == "" || parsed.User != nil {
				return fmt.Errorf("media must be an HTTP URL or base64 data URL")
			}
		}
		if len(media.value) > (8<<20)+256 {
			return fmt.Errorf("media must be at most 8 MiB")
		}
	}
	if _, err := time.LoadLocation(p.Timezone); err != nil {
		return fmt.Errorf("invalid IANA timezone")
	}
	if len(strings.Fields(p.Cron)) != 5 {
		return fmt.Errorf("schedule requires a five-field cron expression")
	}
	if _, err := cron.ParseStandard("CRON_TZ=" + p.Timezone + " " + p.Cron); err != nil {
		return err
	}
	if p.ScheduleEnabled && len(p.Targets) == 0 {
		return fmt.Errorf("scheduled tests require targets")
	}
	return nil
}
func SaveModelTestPlan(db *sqlx.DB, plan ModelTestPlan) error {
	if err := plan.Validate(); err != nil {
		return err
	}
	for _, target := range plan.Targets {
		var count int
		if err := db.Get(&count, db.Rebind("SELECT COUNT(*) FROM accounts WHERE id=?"), target.AccountID); err != nil {
			return err
		}
		if count == 0 {
			return fmt.Errorf("account %d does not exist", target.AccountID)
		}
	}
	for _, target := range plan.Targets {
		var count int
		err := db.Get(&count, db.Rebind(`SELECT COUNT(*) FROM model_availability m JOIN accounts a ON a.id=m.account_id WHERE m.account_id=? AND m.model_name=? AND m.available=? AND NOT EXISTS(SELECT 1 FROM site_disabled_models d WHERE d.site_id=a.site_id AND d.model_name=m.model_name)`), target.AccountID, target.Model, true)
		if err != nil {
			return err
		}
		if count == 0 {
			return fmt.Errorf("model %s is not available for account %d; refresh account models first", target.Model, target.AccountID)
		}
	}

	data, err := json.Marshal(plan)
	if err != nil {
		return err
	}
	_, err = db.Exec(db.Rebind("INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value"), modelTestConfigKey, string(data))
	return err
}
func ModelTestPlanDue(plan ModelTestPlan, now time.Time) bool {
	if !plan.ScheduleEnabled {
		return false
	}
	schedule, err := cron.ParseStandard("CRON_TZ=" + plan.Timezone + " " + plan.Cron)
	if err != nil {
		return false
	}
	minute := now.Truncate(time.Minute)
	return schedule.Next(minute.Add(-time.Minute)).Equal(minute)
}
func ClaimModelTestMinute(db *sqlx.DB, now time.Time) (bool, error) {
	result, err := db.Exec(db.Rebind(`INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE settings.value <> excluded.value`), "model_test_last_minute", now.UTC().Truncate(time.Minute).Format(time.RFC3339))
	if err != nil {
		return false, err
	}
	count, err := result.RowsAffected()
	return count > 0, err
}

type ModelTestResult struct {
	ID          string `json:"id" db:"id"`
	BatchID     string `json:"batchId" db:"batch_id"`
	AccountID   int64  `json:"accountId" db:"account_id"`
	SiteID      int64  `json:"siteId" db:"site_id"`
	SiteName    string `json:"siteName" db:"site_name"`
	AccountName string `json:"accountName" db:"account_name"`
	Model       string `json:"model" db:"model"`
	Type        string `json:"type" db:"type"`
	Source      string `json:"source" db:"source"`
	Status      string `json:"status" db:"status"`
	CreatedAt   string `json:"createdAt" db:"created_at"`
	LatencyMs   int64  `json:"latencyMs" db:"latency_ms"`
	Text        string `json:"text" db:"text"`
	Error       string `json:"error" db:"error"`
	Detail      string `json:"detail" db:"detail"`
}

func RunModelTests(ctx context.Context, db *sqlx.DB, cfg *config.Config, plan ModelTestPlan, source string) (string, error) {
	if err := plan.Validate(); err != nil {
		return "", err
	}
	if len(plan.Targets) == 0 {
		return "", fmt.Errorf("select at least one test target")
	}
	if !modelTestMutex.TryLock() {
		return "", ErrModelTestsBusy
	}
	defer modelTestMutex.Unlock()
	var err error
	plan, err = resolveModelTestNews(ctx, plan)
	if err != nil {
		return "", err
	}
	batch := uuid.NewString()
	for _, target := range plan.Targets {
		if err := ctx.Err(); err != nil {
			return batch, err
		}
		result := ModelTestResult{ID: uuid.NewString(), BatchID: batch, AccountID: target.AccountID, Model: target.Model, Type: target.Type, Source: source, Status: "failed", CreatedAt: time.Now().UTC().Format(time.RFC3339Nano)}
		input := platform.ModelTestInput{Type: target.Type, Model: target.Model, MaxOutputTokens: plan.MaxOutputTokens}
		switch target.Type {
		case "text":
			input.Prompts = plan.TextPrompts
			input.SystemPrompt = plan.SystemPrompt
		case "image":
			input.Prompts = []string{plan.ImagePrompt}
			input.Media = plan.ImageMedia
		case "video":
			input.Prompts = []string{plan.VideoPrompt}
			input.Media = plan.VideoMedia
			input.SystemPrompt = plan.VideoSystemPrompt
		case "codex":
			input.Prompts = []string{plan.CodexPrompt}
			input.SystemPrompt = plan.CodexSystemPrompt
		case "search":
			input.Prompts = []string{plan.SearchPrompt}
		}
		row, err := GetAccountWithSiteByID(db, target.AccountID)
		if err == nil {
			err = db.Get(&row.Site, db.Rebind("SELECT "+SiteSelectColumns+" FROM sites WHERE id=?"), row.Account.SiteID)
		}
		rounds := []platform.ModelTestRound{}
		if err == nil {
			result.SiteID = row.Site.ID
			result.SiteName = row.Site.Name
			if row.Account.Username != nil {
				result.AccountName = *row.Account.Username
			}
			var token string
			token, err = modelTestAccountCredential(db, row)
			if err == nil {
				testCtx, cancel := context.WithTimeout(ctx, time.Duration(plan.TimeoutSeconds)*time.Second)
				rounds = platform.ExecuteModelTest(testCtx, row.Site.URL, token, input, BuildPlatformProxyConfig(cfg, &row.Account, &row.Site))
				cancel()
				for i := range rounds {
					rounds[i].Text = redactModelTestSecrets(rounds[i].Text, token, row)
					rounds[i].Error = redactModelTestSecrets(rounds[i].Error, token, row)
				}
			}
		}
		if err != nil {
			result.Error = err.Error()
		}
		successes := 0
		for _, round := range rounds {
			result.LatencyMs += round.LatencyMs
			if round.Error != "" {
				result.Error = round.Error
			} else {
				successes++
			}
			if round.Text != "" {
				if result.Text != "" {
					result.Text += "\n\n"
				}
				result.Text += round.Text
			}
		}
		if successes == len(input.Prompts) {
			result.Status = "passed"
		} else if successes > 0 {
			result.Status = "partial"
		}
		detail, err := json.Marshal(map[string]any{"input": input, "rounds": rounds})
		if err != nil {
			return batch, err
		}
		result.Detail = string(detail)
		_, err = db.NamedExec(`INSERT INTO model_test_results (id,batch_id,account_id,site_id,site_name,account_name,model,type,source,status,created_at,latency_ms,text,error,detail) VALUES (:id,:batch_id,:account_id,:site_id,:site_name,:account_name,:model,:type,:source,:status,:created_at,:latency_ms,:text,:error,:detail)`, result)
		if err != nil {
			return batch, err
		}
	}
	return batch, nil
}
func modelTestAccountCredential(db *sqlx.DB, row *AccountWithSite) (string, error) {
	if row.Account.Status != "active" || row.Site.Status == "disabled" {
		return "", fmt.Errorf("account or site is disabled")
	}
	if row.Account.OAuthProvider != nil && *row.Account.OAuthProvider != "" {
		return "", fmt.Errorf("OAuth accounts are not supported by direct API tests")
	}
	if row.Account.APIToken != nil && strings.TrimSpace(*row.Account.APIToken) != "" {
		return strings.TrimSpace(*row.Account.APIToken), nil
	}
	token, err := GetDefaultTokenForAccount(db, row.Account.ID)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return "", err
	}
	if token != nil && IsUsableAccountToken(token) {
		return token.Token, nil
	}
	return "", fmt.Errorf("configure an API token or an enabled default account token first")
}
func redactModelTestSecrets(text, token string, row *AccountWithSite) string {
	secrets := []string{token, row.Account.AccessToken}
	if row.Account.APIToken != nil {
		secrets = append(secrets, *row.Account.APIToken)
	}
	for _, secret := range secrets {
		if secret != "" {
			text = strings.ReplaceAll(text, secret, "[redacted]")
		}
	}
	return text
}

type ModelTestHistoryFilter struct {
	Query, Type, Status, SiteTag, From, To, BatchID, Sort string
	Page, PageSize                                        int
}

func ListModelTestHistory(db *sqlx.DB, filter ModelTestHistoryFilter) (map[string]any, error) {
	where := []string{"1=1"}
	args := []any{}
	if filter.Query != "" {
		where = append(where, `LOWER(site_name || ' ' || account_name || ' ' || model || ' ' || text || ' ' || error) LIKE ?`)
		args = append(args, "%"+strings.ToLower(filter.Query)+"%")
	}
	for _, item := range []struct{ column, value string }{{"type", filter.Type}, {"status", filter.Status}, {"batch_id", filter.BatchID}} {
		if item.value != "" {
			where = append(where, item.column+"=?")
			args = append(args, item.value)
		}
	}
	if filter.From != "" {
		where = append(where, "created_at>=?")
		args = append(args, filter.From)
	}
	if filter.To != "" {
		where = append(where, "created_at<?")
		args = append(args, filter.To)
	}
	if filter.SiteTag != "" {
		ids, err := SiteIDsWithTag(db, filter.SiteTag)
		if err != nil {
			return nil, err
		}
		if len(ids) == 0 {
			where = append(where, "1=0")
		} else {
			placeholders := []string{}
			for _, id := range ids {
				placeholders = append(placeholders, "?")
				args = append(args, id)
			}
			where = append(where, "site_id IN ("+strings.Join(placeholders, ",")+")")
		}
	}
	clause := strings.Join(where, " AND ")
	var total int
	if err := db.Get(&total, db.Rebind("SELECT COUNT(*) FROM model_test_results WHERE "+clause), args...); err != nil {
		return nil, err
	}
	order := "created_at DESC,id DESC"
	if filter.Sort != "" {
		columns := map[string]string{"createdAt": "created_at", "account": "site_name", "model": "model", "type": "type", "status": "status", "latencyMs": "latency_ms"}
		parts := []string{}
		for _, field := range strings.Split(filter.Sort, ",") {
			key, direction, _ := strings.Cut(field, ":")
			column, ok := columns[key]
			if !ok || direction != "asc" && direction != "desc" {
				return nil, fmt.Errorf("invalid history sort")
			}
			parts = append(parts, column+" "+strings.ToUpper(direction))
		}
		order = strings.Join(parts, ",") + ",id DESC"
	}
	args = append(args, filter.PageSize, (filter.Page-1)*filter.PageSize)
	rows := []ModelTestResult{}
	err := db.Select(&rows, db.Rebind("SELECT id,batch_id,account_id,site_id,site_name,account_name,model,type,source,status,created_at,latency_ms,SUBSTR(text,1,300) AS text,error,'' AS detail FROM model_test_results WHERE "+clause+" ORDER BY "+order+" LIMIT ? OFFSET ?"), args...)
	return map[string]any{"items": rows, "total": total}, err
}
