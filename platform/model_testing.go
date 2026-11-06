package platform

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"
)

// ModelTestInput is a single test with one or more text rounds.
type ModelTestInput struct {
	Type            string   `json:"type"`
	Model           string   `json:"model"`
	Prompts         []string `json:"prompts"`
	Media           string   `json:"media"`
	MaxOutputTokens int      `json:"maxOutputTokens"`
}
type ModelTestRound struct {
	Prompt       string `json:"prompt"`
	Text         string `json:"text"`
	Error        string `json:"error"`
	LatencyMs    int64  `json:"latencyMs"`
	InputTokens  int    `json:"inputTokens"`
	OutputTokens int    `json:"outputTokens"`
}

func ExecuteModelTest(ctx context.Context, baseURL, token string, input ModelTestInput, proxy *ProxyConfig) []ModelTestRound {
	rounds := []ModelTestRound{}
	messages := []any{}
	for _, prompt := range input.Prompts {
		messages = append(messages, map[string]any{"role": "user", "content": prompt})
		started := time.Now()
		text, inTokens, outTokens, err := executeModelTestRound(ctx, baseURL, token, input, prompt, messages, proxy)
		round := ModelTestRound{Prompt: prompt, Text: text, LatencyMs: time.Since(started).Milliseconds(), InputTokens: inTokens, OutputTokens: outTokens}
		if err != nil {
			round.Error = err.Error()
		}
		rounds = append(rounds, round)
		if err != nil {
			break
		}
		messages = append(messages, map[string]any{"role": "assistant", "content": text})
	}
	return rounds
}

func executeModelTestRound(ctx context.Context, baseURL, token string, input ModelTestInput, prompt string, messages []any, proxy *ProxyConfig) (string, int, int, error) {
	endpoint := "/v1/chat/completions"
	body := map[string]any{"model": input.Model, "messages": messages, "max_tokens": input.MaxOutputTokens, "stream": false}
	headers := authBearerHeaders(token)
	switch input.Type {
	case "image":
		body["messages"] = []any{map[string]any{"role": "user", "content": []any{map[string]any{"type": "text", "text": prompt}, map[string]any{"type": "image_url", "image_url": map[string]any{"url": input.Media}}}}}
	case "video":
		endpoint = "/v1beta/models/" + url.PathEscape(strings.TrimPrefix(input.Model, "models/")) + ":generateContent"
		headers = map[string]string{"X-goog-api-key": token}
		media := map[string]any{"fileData": map[string]any{"fileUri": input.Media, "mimeType": "video/mp4"}}
		if strings.HasPrefix(input.Media, "data:") {
			metadata, data, ok := strings.Cut(strings.TrimPrefix(input.Media, "data:"), ",")
			if !ok {
				return "", 0, 0, fmt.Errorf("invalid video data URL")
			}
			media = map[string]any{"inlineData": map[string]any{"mimeType": strings.TrimSuffix(metadata, ";base64"), "data": data}}
		}
		body = map[string]any{"contents": []any{map[string]any{"role": "user", "parts": []any{media, map[string]any{"text": prompt}}}}, "generationConfig": map[string]any{"maxOutputTokens": input.MaxOutputTokens}}
	case "codex", "search":
		session, turn := uuid.NewString(), uuid.NewString()
		message := map[string]any{"type": "message", "role": "user", "content": []any{map[string]any{"type": "input_text", "text": prompt}}, "internal_chat_message_metadata_passthrough": map[string]any{"turn_id": turn, "create_time": time.Now().Unix(), "content_item_kinds": []string{"user.text"}}}
		headers["originator"] = "codex-tui"
		headers["User-Agent"] = "codex-tui/0.162.1"
		if input.Type == "search" {
			endpoint = "/v1/alpha/search"
			body = map[string]any{"id": session, "model": input.Model, "input": []any{message}, "commands": map[string]any{"search_query": []any{map[string]any{"q": prompt}}, "response_length": "long"}, "settings": map[string]any{"allowed_callers": []string{"direct"}, "external_web_access": true}, "max_output_tokens": input.MaxOutputTokens}
		} else {
			endpoint = "/v1/responses"
			headers["Accept"] = "text/event-stream"
			headers["session-id"] = session
			headers["thread-id"] = session
			headers["x-client-request-id"] = session
			metadata, _ := json.Marshal(map[string]any{"session_id": session, "thread_id": session, "turn_id": turn})
			headers["x-codex-turn-metadata"] = string(metadata)
			body = map[string]any{"model": input.Model, "stream": true, "store": false, "prompt_cache_key": session, "reasoning": map[string]any{"effort": "low", "summary": "auto"}, "tool_choice": "auto", "parallel_tool_calls": true, "include": []string{"reasoning.encrypted_content"}, "tools": []any{map[string]any{"type": "web_search", "external_web_access": true}}, "input": []any{message}}
		}
	}
	encoded, err := json.Marshal(body)
	if err != nil {
		return "", 0, 0, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(baseURL, "/")+endpoint, bytes.NewReader(encoded))
	if err != nil {
		return "", 0, 0, err
	}
	req.Header.Set("Content-Type", "application/json")
	for key, value := range headers {
		req.Header.Set(key, value)
	}
	ApplySiteIdentity(req, proxy)
	response, err := DoWithProxy(ctx, req, proxy)
	if err != nil {
		return "", 0, 0, err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		data, err := readPlatformResponseBody(response.Body, platformErrorResponseBodyLimit)
		if err != nil {
			return "", 0, 0, err
		}
		return "", 0, 0, fmt.Errorf("HTTP %d: %s", response.StatusCode, string(data))
	}
	if input.Type == "codex" {
		return readModelTestSSE(response.Body)
	}
	data, err := readPlatformResponseBody(response.Body, 4<<20)
	if err != nil {
		return "", 0, 0, err
	}
	var payload map[string]json.RawMessage
	if err = json.Unmarshal(data, &payload); err != nil {
		return "", 0, 0, fmt.Errorf("invalid response JSON: %w", err)
	}
	var text string
	var inTokens, outTokens int
	if input.Type == "video" {
		var candidates []struct {
			Content struct{ Parts []struct{ Text string } }
		}
		if err = json.Unmarshal(payload["candidates"], &candidates); err != nil {
			return "", 0, 0, fmt.Errorf("missing video candidates: %w", err)
		}
		if len(candidates) > 0 {
			for _, part := range candidates[0].Content.Parts {
				text += part.Text
			}
		}
		var usage struct {
			PromptTokenCount     int
			CandidatesTokenCount int
		}
		_ = json.Unmarshal(payload["usageMetadata"], &usage)
		inTokens, outTokens = usage.PromptTokenCount, usage.CandidatesTokenCount
	} else if input.Type == "search" {
		var status string
		_ = json.Unmarshal(payload["status"], &status)
		if status == "failed" || status == "incomplete" {
			return "", 0, 0, fmt.Errorf("search response status: %s", status)
		}
		if len(payload) == 0 {
			return "", 0, 0, fmt.Errorf("empty search response")
		}
		if failure, ok := payload["error"]; ok && string(failure) != "null" {
			return "", 0, 0, fmt.Errorf("search failed: %s", failure)
		}
		formatted, err := json.MarshalIndent(payload, "", "  ")
		if err != nil {
			return "", 0, 0, err
		}
		text = string(formatted)
	} else {
		var choices []struct{ Message struct{ Content string } }
		if err = json.Unmarshal(payload["choices"], &choices); err != nil {
			return "", 0, 0, fmt.Errorf("missing chat choices: %w", err)
		}
		if len(choices) > 0 {
			text = choices[0].Message.Content
		}
		var usage struct {
			PromptTokens     int `json:"prompt_tokens"`
			CompletionTokens int `json:"completion_tokens"`
		}
		_ = json.Unmarshal(payload["usage"], &usage)
		inTokens, outTokens = usage.PromptTokens, usage.CompletionTokens
	}
	if strings.TrimSpace(text) == "" {
		return "", inTokens, outTokens, fmt.Errorf("response contains no text")
	}
	return text, inTokens, outTokens, nil
}

type modelTestResponse struct {
	Status string `json:"status"`
	Output []struct {
		Content []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"content"`
	} `json:"output"`
	Usage struct {
		InputTokens  int `json:"input_tokens"`
		OutputTokens int `json:"output_tokens"`
	} `json:"usage"`
}

func modelTestResponseText(response modelTestResponse) string {
	texts := []string{}
	for _, item := range response.Output {
		for _, content := range item.Content {
			if content.Type == "output_text" {
				texts = append(texts, content.Text)
			}
		}
	}
	return strings.Join(texts, "\n")
}
func readModelTestSSE(reader io.Reader) (string, int, int, error) {
	scanner := bufio.NewScanner(io.LimitReader(reader, 4<<20))
	scanner.Buffer(make([]byte, 4096), 1<<20)
	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if data == "[DONE]" {
			continue
		}
		var event struct {
			Type     string            `json:"type"`
			Response modelTestResponse `json:"response"`
			Error    json.RawMessage   `json:"error"`
		}
		if err := json.Unmarshal([]byte(data), &event); err != nil {
			return "", 0, 0, fmt.Errorf("invalid SSE event: %w", err)
		}
		switch event.Type {
		case "response.completed":
			text := modelTestResponseText(event.Response)
			if event.Response.Status != "completed" || strings.TrimSpace(text) == "" {
				return "", 0, 0, fmt.Errorf("response completed without successful text output")
			}
			return text, event.Response.Usage.InputTokens, event.Response.Usage.OutputTokens, nil
		case "response.failed", "response.incomplete", "error":
			return "", 0, 0, fmt.Errorf("%s: %s", event.Type, data)
		}
	}
	if err := scanner.Err(); err != nil {
		return "", 0, 0, err
	}
	return "", 0, 0, fmt.Errorf("response stream ended before response.completed")
}
