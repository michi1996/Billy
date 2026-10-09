#!/usr/bin/env bash
# Smoke test for the Buddy LLM server (llama-server behind Cloudflare Access).
#
# Needs: bash, curl (>= 7.55), python3.
# Reads LLM_BASE_URL, CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET from the environment
# (optionally LLM_MODEL, and LLM_API_KEY if llama-server runs with --api-key). The token values
# are never printed and never passed as command-line arguments (curl reads the headers from a
# file with mode 600).
#
#   LLM_BASE_URL=https://llm.example.com \
#   CF_ACCESS_CLIENT_ID=... CF_ACCESS_CLIENT_SECRET=... ./smoke-test.sh

set -euo pipefail

if [[ -z "${LLM_BASE_URL:-}" || -z "${CF_ACCESS_CLIENT_ID:-}" || -z "${CF_ACCESS_CLIENT_SECRET:-}" ]]; then
    echo "Please set LLM_BASE_URL, CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET." >&2
    exit 2
fi
for tool in curl python3; do
    command -v "$tool" >/dev/null || { echo "$tool is missing." >&2; exit 2; }
done

base="${LLM_BASE_URL%/}"
base="${base%/v1/chat/completions}"
base="${base%/v1}"
url="$base/v1/chat/completions"
model="${LLM_MODEL:-qwen2.5-14b-instruct}"

workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT
umask 077
# printf is a shell builtin, so the values don't show up in the process list.
printf 'CF-Access-Client-Id: %s\nCF-Access-Client-Secret: %s\n' \
    "$CF_ACCESS_CLIENT_ID" "$CF_ACCESS_CLIENT_SECRET" > "$workdir/auth-headers"
if [[ -n "${LLM_API_KEY:-}" ]]; then
    printf 'Authorization: Bearer %s\n' "$LLM_API_KEY" >> "$workdir/auth-headers"
fi

failures=0
pass() { echo "  OK    $*"; }
warn() { echo "  WARN  $*"; }
fail() { echo "  FAIL  $*"; failures=$((failures + 1)); }

# post <body-file> <out-file> [auth] -> prints "<http_code> <seconds> <content_type>"
post() {
    local auth=()
    if [[ "${3:-}" == "auth" ]]; then
        auth=(-H "@$workdir/auth-headers")
    fi
    curl -sS --max-time 95 -o "$2" \
        -w '%{http_code} %{time_total} %{content_type}\n' \
        -X POST "$url" \
        -H 'Content-Type: application/json' -H 'Accept: application/json' \
        ${auth[@]+"${auth[@]}"} \
        --data-binary "@$1" || echo "000 0 -"
}

# json <file> <python expression on d> -> prints the value, empty on error
json() {
    python3 - "$1" "$2" <<'PY' 2>/dev/null || true
import json, sys
try:
    d = json.load(open(sys.argv[1]))
    v = eval(sys.argv[2], {}, {'d': d, 'json': json})
    print(v if v is not None else '')
except Exception:
    pass
PY
}

snippet() {
    if [[ -f "$1" ]]; then
        head -c 200 "$1" | tr '\n' ' '
    fi
}

seconds() {
    python3 -c "import sys; print('%.2f s' % float(sys.argv[1]))" "$1" 2>/dev/null || echo "$1 s"
}

tools='[{"type":"function","function":{"name":"set_timer","description":"Start a countdown timer on the watch.","parameters":{"type":"object","properties":{"duration_seconds":{"type":"integer","description":"Timer length in seconds, e.g. 300 for 5 minutes."},"name":{"type":"string","description":"Only if the user explicitly named the timer."}},"required":["duration_seconds"]}}}]'
system='You are Buddy, a voice assistant on a Pebble smartwatch. Use the tools for timers. Never claim something was set unless a tool result says "status": "ok". Reply in the language of the user, 1-2 short lines.'

echo "Server: $base"
echo

echo "(a) A request without the service token is rejected"
cat > "$workdir/plain.json" <<JSON
{"model":"$model","messages":[{"role":"user","content":"Hello"}],"max_tokens":5,"stream":false}
JSON
read -r code secs ctype < <(post "$workdir/plain.json" "$workdir/a.body")
if [[ "$code" == "000" ]]; then
    fail "Server unreachable"
elif [[ "$code" =~ ^(30[1237]|401|403)$ || "$ctype" == text/html* ]]; then
    pass "rejected (HTTP $code, ${ctype:-no content type})"
elif [[ "$code" == "200" && -n "$(json "$workdir/a.body" "d['choices'][0]['message']")" ]]; then
    fail "Got an answer WITHOUT the token - Cloudflare Access is not protecting the hostname!"
else
    warn "unexpected response HTTP $code ($ctype): $(snippet "$workdir/a.body")"
fi

echo "(b) A request with the service token returns JSON"
cat > "$workdir/hello.json" <<JSON
{"model":"$model","messages":[{"role":"user","content":"Reply with just: OK"}],"max_tokens":10,"temperature":0,"stream":false}
JSON
read -r code secs ctype < <(post "$workdir/hello.json" "$workdir/b.body" auth)
content="$(json "$workdir/b.body" "d['choices'][0]['message']['content']")"
if [[ "$code" == "200" && "$ctype" == application/json* && -n "$content" ]]; then
    pass "HTTP 200, JSON, answer: $(echo "$content" | head -c 60) ($(seconds "$secs"))"
elif [[ "$code" == "401" && "$ctype" == application/json* ]]; then
    fail "HTTP 401 from llama-server - set LLM_API_KEY to the key llama-server was started with (--api-key)"
elif [[ "$ctype" == text/html* || "$code" =~ ^(30[1237]|401|403)$ ]]; then
    fail "Access denied (HTTP $code, $ctype) - check the service token and the Access policy (Service Auth)"
elif [[ "$code" == "000" ]]; then
    fail "Server unreachable"
elif [[ "$code" == "524" ]]; then
    fail "HTTP 524: the model took longer than 100 s"
else
    fail "HTTP $code ($ctype): $(snippet "$workdir/b.body")"
fi

echo "(c) A set_timer tool call comes back as tool_calls"
python3 - "$workdir/round1.json" "$model" "$system" "$tools" <<'PY'
import json, sys
out, model, system, tools = sys.argv[1:5]
body = {
    "model": model,
    "messages": [
        {"role": "system", "content": system},
        {"role": "user", "content": "[Context] now=2026-10-07T21:46+02:00 Wednesday\nSet a timer for 5 minutes."},
    ],
    "tools": json.loads(tools),
    "tool_choice": "auto",
    "parallel_tool_calls": False,
    "temperature": 0.2,
    "max_tokens": 300,
    "stream": False,
    "cache_prompt": True,
}
json.dump(body, open(out, "w"))
PY
read -r code1 secs1 ctype < <(post "$workdir/round1.json" "$workdir/c.body" auth)
name="$(json "$workdir/c.body" "d['choices'][0]['message']['tool_calls'][0]['function']['name']")"
duration="$(json "$workdir/c.body" "json.loads(d['choices'][0]['message']['tool_calls'][0]['function']['arguments'])['duration_seconds']")"
if [[ "$code1" == "000" ]]; then
    fail "Server unreachable"
elif [[ "$code1" != "200" ]]; then
    fail "HTTP $code1 ($ctype): $(snippet "$workdir/c.body")"
elif [[ "$name" == "set_timer" && "$duration" == "300" ]]; then
    pass "set_timer with duration_seconds=300 ($(seconds "$secs1"))"
elif [[ "$name" == "set_timer" ]]; then
    warn "set_timer called, but with duration_seconds=$duration instead of 300"
else
    fail "no tool_calls entry. Is llama-server running with --jinja, and does the chat template support tools? Response: $(snippet "$workdir/c.body")"
fi

echo "(d) Latency of two rounds (tool call, then the answer with the tool result)"
if [[ "$name" == "set_timer" ]]; then
    python3 - "$workdir/round1.json" "$workdir/c.body" "$workdir/round2.json" <<'PY'
import json, sys
request = json.load(open(sys.argv[1]))
reply = json.load(open(sys.argv[2]))["choices"][0]["message"]
call = reply["tool_calls"][0]
request["messages"].append({
    "role": "assistant",
    "content": reply.get("content") or "",
    "tool_calls": [{"id": call.get("id") or "call_0", "type": "function", "function": call["function"]}],
})
request["messages"].append({"role": "tool", "tool_call_id": call.get("id") or "call_0", "content": json.dumps({"status": "ok"})})
json.dump(request, open(sys.argv[3], "w"))
PY
    read -r code2 secs2 ctype < <(post "$workdir/round2.json" "$workdir/d.body" auth)
    answer="$(json "$workdir/d.body" "d['choices'][0]['message']['content']")"
    if [[ "$code2" == "200" && -n "$answer" ]]; then
        pass "answer: $(echo "$answer" | tr '\n' ' ' | head -c 80)"
    else
        fail "second round: HTTP $code2 ($ctype): $(snippet "$workdir/d.body")"
    fi
    total="$(python3 -c "import sys; print(float(sys.argv[1]) + float(sys.argv[2]))" "$secs1" "$secs2")"
    echo "        Round 1: $(seconds "$secs1")   Round 2: $(seconds "$secs2")   Total: $(seconds "$total")"
    for round in c d; do
        stats="$(json "$workdir/$round.body" "'prompt tokens %s, recomputed %s (%.0f ms), generated %s (%.0f ms)' % (d['usage']['prompt_tokens'], d['timings']['prompt_n'], d['timings']['prompt_ms'], d['timings']['predicted_n'], d['timings']['predicted_ms'])")"
        [[ -n "$stats" ]] && echo "        $([[ $round == c ]] && echo 'Round 1' || echo 'Round 2'): $stats"
    done
else
    warn "skipped because (c) returned no tool call"
fi

echo
if [[ "$failures" -gt 0 ]]; then
    echo "$failures check(s) failed."
    exit 1
fi
echo "All checks passed."
