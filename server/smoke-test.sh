#!/usr/bin/env bash
# Smoke-Test für den Benny-LLM-Server (llama-server hinter Cloudflare Access).
#
# Benötigt: bash, curl (>= 7.55), python3.
# Liest LLM_BASE_URL, CF_ACCESS_CLIENT_ID und CF_ACCESS_CLIENT_SECRET aus der Umgebung
# (optional LLM_MODEL). Die Token-Werte werden nie ausgegeben und auch nicht als
# Kommandozeilenargument übergeben (curl liest die Header aus einer Datei mit Rechten 600).
#
#   LLM_BASE_URL=https://llm.example.ch \
#   CF_ACCESS_CLIENT_ID=... CF_ACCESS_CLIENT_SECRET=... ./smoke-test.sh

set -euo pipefail

if [[ -z "${LLM_BASE_URL:-}" || -z "${CF_ACCESS_CLIENT_ID:-}" || -z "${CF_ACCESS_CLIENT_SECRET:-}" ]]; then
    echo "Bitte LLM_BASE_URL, CF_ACCESS_CLIENT_ID und CF_ACCESS_CLIENT_SECRET setzen." >&2
    exit 2
fi
for tool in curl python3; do
    command -v "$tool" >/dev/null || { echo "$tool fehlt." >&2; exit 2; }
done

base="${LLM_BASE_URL%/}"
base="${base%/v1/chat/completions}"
base="${base%/v1}"
url="$base/v1/chat/completions"
model="${LLM_MODEL:-qwen2.5-14b-instruct}"

workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT
umask 077
# printf ist ein Shell-Builtin: die Werte tauchen nicht in der Prozessliste auf.
printf 'CF-Access-Client-Id: %s\nCF-Access-Client-Secret: %s\n' \
    "$CF_ACCESS_CLIENT_ID" "$CF_ACCESS_CLIENT_SECRET" > "$workdir/auth-headers"

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
system='You are Benny, a voice assistant on a Pebble smartwatch. Use the tools for timers. Never claim something was set unless a tool result says "status": "ok". Reply in German, 1-2 short lines.'

echo "Server: $base"
echo

echo "(a) Anfrage ohne Service Token wird abgewiesen"
cat > "$workdir/plain.json" <<JSON
{"model":"$model","messages":[{"role":"user","content":"Hallo"}],"max_tokens":5,"stream":false}
JSON
read -r code secs ctype < <(post "$workdir/plain.json" "$workdir/a.body")
if [[ "$code" == "000" ]]; then
    fail "Server nicht erreichbar"
elif [[ "$code" =~ ^(30[1237]|401|403)$ || "$ctype" == text/html* ]]; then
    pass "abgewiesen (HTTP $code, ${ctype:-ohne Content-Type})"
elif [[ "$code" == "200" && -n "$(json "$workdir/a.body" "d['choices'][0]['message']")" ]]; then
    fail "Antwort OHNE Token erhalten - Cloudflare Access schützt den Hostnamen nicht!"
else
    warn "unerwartete Antwort HTTP $code ($ctype): $(snippet "$workdir/a.body")"
fi

echo "(b) Anfrage mit Service Token liefert JSON"
cat > "$workdir/hello.json" <<JSON
{"model":"$model","messages":[{"role":"user","content":"Antworte nur mit: OK"}],"max_tokens":10,"temperature":0,"stream":false}
JSON
read -r code secs ctype < <(post "$workdir/hello.json" "$workdir/b.body" auth)
content="$(json "$workdir/b.body" "d['choices'][0]['message']['content']")"
if [[ "$code" == "200" && "$ctype" == application/json* && -n "$content" ]]; then
    pass "HTTP 200, JSON, Antwort: $(echo "$content" | head -c 60) ($(seconds "$secs"))"
elif [[ "$ctype" == text/html* || "$code" =~ ^(30[1237]|401|403)$ ]]; then
    fail "Zugang verweigert (HTTP $code, $ctype) - Service Token und Access-Policy (Service Auth) prüfen"
elif [[ "$code" == "000" ]]; then
    fail "Server nicht erreichbar"
elif [[ "$code" == "524" ]]; then
    fail "HTTP 524: Modell hat länger als 100 s gebraucht"
else
    fail "HTTP $code ($ctype): $(snippet "$workdir/b.body")"
fi

echo "(c) Tool-Aufruf set_timer kommt als tool_calls zurück"
python3 - "$workdir/round1.json" "$model" "$system" "$tools" <<'PY'
import json, sys
out, model, system, tools = sys.argv[1:5]
body = {
    "model": model,
    "messages": [
        {"role": "system", "content": system},
        {"role": "user", "content": "[Context] now=2026-10-07T21:46+02:00 Wednesday\nStell einen Timer auf 5 Minuten."},
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
    fail "Server nicht erreichbar"
elif [[ "$code1" != "200" ]]; then
    fail "HTTP $code1 ($ctype): $(snippet "$workdir/c.body")"
elif [[ "$name" == "set_timer" && "$duration" == "300" ]]; then
    pass "set_timer mit duration_seconds=300 ($(seconds "$secs1"))"
elif [[ "$name" == "set_timer" ]]; then
    warn "set_timer aufgerufen, aber duration_seconds=$duration statt 300"
else
    fail "kein tool_calls-Eintrag. Läuft llama-server mit --jinja und unterstützt das Chat-Template Tools? Antwort: $(snippet "$workdir/c.body")"
fi

echo "(d) Latenz von zwei Runden (Tool-Aufruf, dann Antwort mit Tool-Ergebnis)"
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
        pass "Antwort: $(echo "$answer" | tr '\n' ' ' | head -c 80)"
    else
        fail "zweite Runde: HTTP $code2 ($ctype): $(snippet "$workdir/d.body")"
    fi
    total="$(python3 -c "import sys; print(float(sys.argv[1]) + float(sys.argv[2]))" "$secs1" "$secs2")"
    echo "        Runde 1: $(seconds "$secs1")   Runde 2: $(seconds "$secs2")   Total: $(seconds "$total")"
    for round in c d; do
        stats="$(json "$workdir/$round.body" "'Prompt-Tokens %s, davon neu berechnet %s (%.0f ms), generiert %s (%.0f ms)' % (d['usage']['prompt_tokens'], d['timings']['prompt_n'], d['timings']['prompt_ms'], d['timings']['predicted_n'], d['timings']['predicted_ms'])")"
        [[ -n "$stats" ]] && echo "        $([[ $round == c ]] && echo 'Runde 1' || echo 'Runde 2'): $stats"
    done
else
    warn "übersprungen, weil (c) keinen Tool-Aufruf geliefert hat"
fi

echo
if [[ "$failures" -gt 0 ]]; then
    echo "$failures Prüfung(en) fehlgeschlagen."
    exit 1
fi
echo "Alle Prüfungen bestanden."
