package platform

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestExecuteModelTests(t *testing.T) {
	for _, kind := range []string{"text", "image", "video", "codex", "search"} {
		t.Run(kind, func(t *testing.T) {
			calls := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				var body map[string]any
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Fatal(err)
				}
				if kind == "video" {
					if r.URL.Path != "/v1beta/models/test-model:generateContent" || r.Header.Get("X-goog-api-key") != "synthetic-api-key" {
						t.Errorf("invalid video request %s", r.URL.Path)
					}
					parts := body["contents"].([]any)[0].(map[string]any)["parts"].([]any)
					if parts[0].(map[string]any)["inlineData"] == nil {
						t.Error("video bytes missing")
					}
					fmt.Fprint(w, `{"candidates":[{"content":{"parts":[{"text":"video ok"}]}}],"usageMetadata":{"promptTokenCount":3,"candidatesTokenCount":4}}`)
					return
				}
				if r.Header.Get("Authorization") != "Bearer synthetic-api-key" {
					t.Error("API token not sent")
				}
				switch kind {
				case "text":
					messages := body["messages"].([]any)
					if len(messages) != calls*2-1 {
						t.Errorf("lost conversation: %v", messages)
					}
					fmt.Fprint(w, `{"choices":[{"message":{"content":"text ok"}}],"usage":{"prompt_tokens":3,"completion_tokens":4}}`)
				case "image":
					parts := body["messages"].([]any)[0].(map[string]any)["content"].([]any)
					if parts[1].(map[string]any)["image_url"].(map[string]any)["url"] != "data:image/png;base64,aGk=" {
						t.Error("image missing")
					}
					fmt.Fprint(w, `{"choices":[{"message":{"content":"image ok"}}]}`)
				case "codex":
					if r.URL.Path != "/v1/responses" || body["stream"] != true || body["store"] != false || r.Header.Get("originator") != "codex-tui" {
						t.Error("invalid Codex protocol")
					}
					fmt.Fprint(w, "data: {\"type\":\"response.completed\",\"response\":{\"status\":\"completed\",\"output\":[{\"content\":[{\"type\":\"output_text\",\"text\":\"codex ok\"}]}],\"usage\":{\"input_tokens\":3,\"output_tokens\":4}}}\n\n")
				case "search":
					if r.URL.Path != "/v1/alpha/search" || body["commands"] == nil {
						t.Error("invalid search protocol")
					}
					fmt.Fprint(w, `{"results":[{"title":"search ok","url":"https://example.com"}]}`)
				}
			}))
			defer server.Close()
			input := ModelTestInput{Type: kind, Model: "test-model", Prompts: []string{"first"}, MaxOutputTokens: 16}
			if kind == "text" {
				input.Prompts = append(input.Prompts, "second", "third")
			}
			if kind == "image" {
				input.Media = "data:image/png;base64,aGk="
			}
			if kind == "video" {
				input.Media = "data:video/mp4;base64,aGk="
			}
			rounds := ExecuteModelTest(context.Background(), server.URL, "synthetic-api-key", input, nil)
			if len(rounds) != len(input.Prompts) {
				t.Fatalf("rounds=%+v", rounds)
			}
			for _, round := range rounds {
				if round.Error != "" || !strings.Contains(round.Text, "ok") {
					t.Fatalf("round=%+v", round)
				}
			}
		})
	}
}
func TestModelTestRejectsIncompleteCodexStream(t *testing.T) {
	for _, stream := range []string{"data: {\"type\":\"response.output_text.delta\",\"delta\":\"partial\"}\n\n", "data: {\"type\":\"response.failed\"}\n\n"} {
		if _, _, _, err := readModelTestSSE(strings.NewReader(stream)); err == nil {
			t.Fatal("incomplete stream accepted")
		}
	}
}
