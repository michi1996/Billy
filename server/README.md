# Buddy server: llama.cpp behind Cloudflare Access

Buddy sends every request from the Pebble app on the phone straight to your own `llama-server`
(llama.cpp's OpenAI-compatible API). The server is not exposed to the internet directly; it is
reachable through a Cloudflare Tunnel and protected by a **Cloudflare Access service token**.

```
Pebble watch ──Bluetooth──▶ Pebble app (PebbleKit JS) ──HTTPS + service token──▶ Cloudflare Access
                                                                                       │
                                                         cloudflared tunnel ◀──────────┘
                                                                │
                                                      llama-server 127.0.0.1:8080
```

## 1. Model

Recommended: **Qwen2.5-14B-Instruct** as GGUF.

| Quantisation | Size approx. | Note |
|---|---|---|
| `Q4_K_M` | 9 GB | good default, fits in 12 GB VRAM including context |
| `Q5_K_M` | 10.5 GB | slightly more accurate, needs about 14 GB VRAM including context |

Below that (Q3, Q2) mostly the reliability of tool calls suffers.

Download it e.g. from the official repository `Qwen/Qwen2.5-14B-Instruct-GGUF`. The files there
are split into several parts; `llama-server` loads them when you point it at the first part
(`…-00001-of-0000N.gguf`). Alternatively llama.cpp downloads the model itself:
`-hf Qwen/Qwen2.5-14B-Instruct-GGUF:Q4_K_M`.

## 2. Start llama-server

```sh
llama-server \
  -m /models/qwen2.5-14b-instruct-q4_k_m-00001-of-00003.gguf \
  --jinja \
  --host 127.0.0.1 --port 8080 \
  -fa on \
  -ngl 99 \
  -c 8192 \
  -np 1 \
  --alias qwen2.5-14b-instruct
```

- `--jinja` is **required**: only with the Jinja chat template does the server understand
  `tools` and return `tool_calls`.
- `--host 127.0.0.1`: the server only listens locally and is reachable only through the tunnel.
- `-fa on` (flash attention). Older llama.cpp builds only know the bare `-fa` switch.
- `-ngl 99` puts all layers on the GPU; `-c 8192` is enough for the system prompt, the tools and
  the last three conversation turns.
- `-np 1` (one slot): Buddy sends the same system prompt and tool list with every request. With
  a single slot that prefix stays in the KV cache and is not recomputed (Buddy sets
  `cache_prompt: true`). This saves several seconds per request.
- Optional `--api-key <key>`: llama-server then also requires its own key
  (`Authorization: Bearer`). Buddy sends it when you enter it under *llama-server API key*.
  This is a second lock behind Cloudflare Access, in case the Access policy is ever changed by
  mistake. For the smoke test, set `LLM_API_KEY` as well.
- **Don't quantise the KV cache aggressively.** The default is f16. If VRAM is tight,
  `-ctk q8_0 -ctv q8_0` is still fine; `q4_0` for the KV cache noticeably hurts tool calls and
  date arithmetic.

### Check the chat template

```sh
curl -s http://127.0.0.1:8080/props | python3 -m json.tool | less
```

The template in the `chat_template` field has to handle tools (for Qwen 2.5 it contains `tools`
and `<tool_call>`); newer builds also show `chat_template_caps.supports_tools: true`. If that is
missing because the GGUF file ships an old or stripped-down template, pass the template
explicitly:

```sh
llama-server … --jinja --chat-template-file qwen2.5-instruct.jinja
```

A matching template is in the llama.cpp repository under `models/templates/` (Qwen2.5-Instruct)
or in the original model's `tokenizer_config.json` on Hugging Face.

### Test locally

```sh
curl -s http://127.0.0.1:8080/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"messages":[{"role":"user","content":"Set a timer for 5 minutes."}],
       "tools":[{"type":"function","function":{"name":"set_timer","parameters":{"type":"object",
       "properties":{"duration_seconds":{"type":"integer"}},"required":["duration_seconds"]}}}]}'
```

The response must contain `choices[0].message.tool_calls` with `set_timer`.

## 3. Cloudflare Tunnel

```sh
cloudflared tunnel login
cloudflared tunnel create buddy-llm
cloudflared tunnel route dns buddy-llm llm.example.com
```

`/etc/cloudflared/config.yml`:

```yaml
tunnel: <TUNNEL-UUID>
credentials-file: /etc/cloudflared/<TUNNEL-UUID>.json

ingress:
  - hostname: llm.example.com
    service: http://127.0.0.1:8080
    originRequest:
      connectTimeout: 10s
  - service: http_status:404
```

Then run `cloudflared tunnel run buddy-llm`, or install it as a service:
`sudo cloudflared service install`.

## 4. Cloudflare Access (service token)

1. **Create a service token:** Zero Trust → Access → Service Auth → Service Tokens →
   *Create Service Token*. Save the client ID and client secret right away – the secret is only
   shown once. The token expires after the chosen duration (one year by default); then create a
   new one and enter it in Buddy.
2. **Create an application:** Zero Trust → Access → Applications → *Add an application* →
   **Self-hosted**, domain `llm.example.com`.
3. **Policy:** action **Service Auth** (not *Allow*), Include → *Service Token* → your token.
   No other policies are needed. Without the token, Access redirects to its login page or answers
   with 401/403; Buddy detects this and shows "Access denied - check the service token".

Buddy sends the token in the `CF-Access-Client-Id` and `CF-Access-Client-Secret` headers, never
in the URL.

### Turn off bot protection and challenges for the hostname

Requests come from the Pebble app, not from a browser. Nobody can solve a JavaScript or captcha
challenge there, so the request fails.

- **Bot Fight Mode** (Security → Bots) applies to the whole zone on Free plans and cannot be
  skipped per hostname: turn it off for this zone (or run the LLM hostname in a separate zone).
  With **Super Bot Fight Mode** (Pro and above), create a WAF custom rule
  `http.host eq "llm.example.com"` with the action *Skip* → *All Super Bot Fight Mode Rules*.
- **Challenges:** create a Configuration Rule for the hostname (Security Level
  *Essentially Off*, Browser Integrity Check off) and make sure no WAF or rate-limiting rule with
  a *Managed/JS Challenge* applies. "I'm Under Attack" mode must not be on.

### Time limit

Cloudflare aborts requests whose origin does not answer within **100 seconds** with HTTP 524.
Buddy therefore limits the timeout (setting 10–90 s, default 45 s) and the answer length
(`max_tokens: 300`). On a reasonable GPU one round with a cached prefix usually takes 1–5 seconds.

## 5. Smoke test

`smoke-test.sh` checks from the outside, through Cloudflare, that:

- (a) a request **without** the token is rejected,
- (b) a request **with** the token returns JSON,
- (c) a tool call (`set_timer`) comes back correctly as `tool_calls`,
- (d) and it prints the latency of two rounds (tool call, then the answer with the tool result),
  including llama-server's prompt cache statistics.

```sh
export LLM_BASE_URL=https://llm.example.com
export CF_ACCESS_CLIENT_ID=…
export CF_ACCESS_CLIENT_SECRET=…
./smoke-test.sh
```

Needs `bash`, `curl` and `python3`. The token values are never printed and not passed as
command-line arguments; they reach `curl` through a temporary file (mode 600) that is deleted
afterwards.

## 6. Troubleshooting

The watch shows the server's own error text after the status code; the app log
(CloudPebble or `pebble logs`) has the full text in a line starting with `LLM server error:`.

| Message on the watch | Cause and fix |
|---|---|
| `Server error (400): tools param requires --jinja flag` | llama-server was started without `--jinja`. Buddy always sends tools; restart with `--jinja`. |
| `Server error (400): the request exceeds the available context size…` | Context too small; raise `-c` (8192 is enough for Buddy). |
| `Access denied - check the API key` | llama-server runs with `--api-key` and the key in Buddy's settings is missing or wrong. |
| `Access denied - check the service token` | Token wrong or expired, or the Access policy is not *Service Auth*. Check with `smoke-test.sh` (a) and (b). |
| `Server unreachable (530)` / `(502)` | The tunnel or llama-server is down; check `cloudflared` and llama-server. |
| `The model took too long` | Cloudflare's 100 s limit (HTTP 524). Use a smaller quantisation, keep `-np 1` for the prompt cache, or check that the model runs on the GPU. |
| `Server error (404): …` | Wrong URL or path. Enter only the base URL; Buddy appends `/v1/chat/completions`. |
| The answer only appears at the end | Expected on iPhone (the Pebble app reads the whole response first). On Android, check the app log: `Streamed request failed …; retrying without streaming` means the server rejected `stream: true` with tools – update llama-server. Streaming can be switched off under *Show answers while they are written*. |

Other OpenAI-compatible servers (e.g. Ollama, LM Studio, vLLM) also work if they support tool
calls. There the *Model* setting must match the name of the loaded model.

## 7. Configure Buddy

In the Pebble app → Buddy → Settings:

- **Server URL:** `https://llm.example.com` (no path; Buddy appends `/v1/chat/completions`)
- **Cloudflare Access Client ID / Client Secret:** from step 4
- **llama-server API key:** only if you started llama-server with `--api-key`
- **Model:** `qwen2.5-14b-instruct` (must match a model name your server knows, e.g. its `--alias`)
- **Request timeout:** 45 s is a good start, 90 s at most

The values stay in the Pebble app on the phone and are never sent to the watch.
