# Benny-Server: llama.cpp hinter Cloudflare Access

Benny schickt jede Anfrage aus der Pebble-App auf dem Handy direkt an deinen eigenen
`llama-server` (OpenAI-kompatible API von llama.cpp). Der Server ist nicht offen im Internet,
sondern über einen Cloudflare Tunnel erreichbar und mit einem **Cloudflare Access Service Token**
geschützt.

```
Pebble-Uhr ──Bluetooth──▶ Pebble-App (PebbleKit JS) ──HTTPS + Service Token──▶ Cloudflare Access
                                                                                     │
                                                       cloudflared-Tunnel ◀──────────┘
                                                              │
                                                    llama-server 127.0.0.1:8080
```

## 1. Modell

Empfohlen: **Qwen2.5-14B-Instruct** als GGUF.

| Quantisierung | Grösse ca. | Hinweis |
|---|---|---|
| `Q4_K_M` | 9 GB | guter Standard, passt mit Kontext in 12 GB VRAM |
| `Q5_K_M` | 10.5 GB | etwas genauer, braucht ca. 14 GB VRAM mit Kontext |

Darunter (Q3, Q2) leidet vor allem die Zuverlässigkeit der Tool-Aufrufe.

Download z. B. aus dem offiziellen Repository `Qwen/Qwen2.5-14B-Instruct-GGUF`. Die Dateien sind
dort in mehrere Teile gesplittet; `llama-server` lädt sie, wenn du den ersten Teil
(`…-00001-of-0000N.gguf`) angibst. Alternativ lädt llama.cpp das Modell selbst:
`-hf Qwen/Qwen2.5-14B-Instruct-GGUF:Q4_K_M`.

## 2. llama-server starten

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

- `--jinja` ist **Pflicht**: Nur mit dem Jinja-Chat-Template versteht der Server `tools` und gibt
  `tool_calls` zurück.
- `--host 127.0.0.1`: Der Server lauscht nur lokal, erreichbar ist er ausschliesslich über den Tunnel.
- `-fa on` (Flash Attention). Ältere llama.cpp-Builds kennen nur den Schalter `-fa` ohne Wert.
- `-ngl 99` lädt alle Schichten auf die GPU, `-c 8192` reicht für Systemprompt, Tools und die
  letzten drei Gesprächsrunden.
- `-np 1` (ein Slot): Benny schickt bei jeder Anfrage denselben Systemprompt und dieselbe
  Tool-Liste. Mit einem Slot bleibt dieser Präfix im KV-Cache und wird nicht neu berechnet
  (Benny setzt `cache_prompt: true`). Das spart pro Anfrage mehrere Sekunden.
- **KV-Cache nicht extrem quantisieren.** Standard ist f16. Wenn der VRAM knapp ist, ist
  `-ctk q8_0 -ctv q8_0` noch unproblematisch; `q4_0` für den KV-Cache verschlechtert
  Tool-Aufrufe und Datumsrechnungen spürbar.

### Chat-Template prüfen

```sh
curl -s http://127.0.0.1:8080/props | python3 -m json.tool | less
```

Im Feld `chat_template` muss das Template Tools verarbeiten (bei Qwen 2.5 sind `tools` und
`<tool_call>` darin zu finden); neuere Builds zeigen zusätzlich
`chat_template_caps.supports_tools: true`. Fehlt das, weil die GGUF-Datei ein altes oder
abgespecktes Template enthält, gib das Template explizit an:

```sh
llama-server … --jinja --chat-template-file qwen2.5-instruct.jinja
```

Ein passendes Template steht im llama.cpp-Repository unter `models/templates/` (Qwen2.5-Instruct)
oder in der `tokenizer_config.json` des Original-Modells auf Hugging Face.

### Lokal testen

```sh
curl -s http://127.0.0.1:8080/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"messages":[{"role":"user","content":"Stell einen Timer auf 5 Minuten."}],
       "tools":[{"type":"function","function":{"name":"set_timer","parameters":{"type":"object",
       "properties":{"duration_seconds":{"type":"integer"}},"required":["duration_seconds"]}}}]}'
```

Die Antwort muss `choices[0].message.tool_calls` mit `set_timer` enthalten.

## 3. Cloudflare Tunnel

```sh
cloudflared tunnel login
cloudflared tunnel create benny-llm
cloudflared tunnel route dns benny-llm llm.example.ch
```

`/etc/cloudflared/config.yml`:

```yaml
tunnel: <TUNNEL-UUID>
credentials-file: /etc/cloudflared/<TUNNEL-UUID>.json

ingress:
  - hostname: llm.example.ch
    service: http://127.0.0.1:8080
    originRequest:
      connectTimeout: 10s
  - service: http_status:404
```

Danach `cloudflared tunnel run benny-llm` bzw. als Dienst: `sudo cloudflared service install`.

## 4. Cloudflare Access (Service Token)

1. **Service Token anlegen:** Zero Trust → Access → Service Auth → Service Tokens →
   *Create Service Token*. Client ID und Client Secret sofort sichern – das Secret wird nur
   einmal angezeigt. Das Token läuft nach der gewählten Dauer ab (Standard ein Jahr), danach
   ein neues anlegen und in Benny eintragen.
2. **Anwendung anlegen:** Zero Trust → Access → Applications → *Add an application* →
   **Self-hosted**, Domain `llm.example.ch`.
3. **Policy:** Aktion **Service Auth** (nicht *Allow*), Include → *Service Token* → dein Token.
   Weitere Policies sind nicht nötig; ohne Token leitet Access auf die Login-Seite um bzw.
   antwortet mit 401/403. Benny erkennt das und meldet „Zugang verweigert – Service Token prüfen“.

Benny schickt das Token als `CF-Access-Client-Id` und `CF-Access-Client-Secret` im Header,
nie in der URL.

### Bot-Schutz und Challenges für den Hostnamen abschalten

Die Anfragen kommen nicht aus einem Browser, sondern aus der Pebble-App. Ein JavaScript- oder
Captcha-Challenge kann dort niemand lösen, die Anfrage scheitert dann.

- **Bot Fight Mode** (Security → Bots) gilt bei Free-Plänen für die ganze Zone und lässt sich
  nicht pro Hostname ausnehmen: für diese Zone ausschalten (oder den LLM-Hostnamen in einer
  eigenen Zone betreiben). Mit **Super Bot Fight Mode** (Pro und höher) eine
  WAF-Custom-Rule `http.host eq "llm.example.ch"` mit Aktion *Skip* → *All Super Bot Fight Mode
  Rules* anlegen.
- **Challenges:** Für den Hostnamen eine Configuration Rule anlegen (Security Level
  *Essentially Off*, Browser Integrity Check aus) und darauf achten, dass keine WAF- oder
  Rate-Limiting-Regel mit *Managed/JS Challenge* greift. „I'm Under Attack“ darf nicht aktiv sein.

### Zeitlimit

Cloudflare bricht Anfragen, auf die der Ursprung nicht innerhalb von **100 Sekunden** antwortet,
mit HTTP 524 ab. Benny begrenzt deshalb den Timeout (Einstellung 10–90 s, Standard 45 s) und die
Antwortlänge (`max_tokens: 300`). Auf einer brauchbaren GPU dauert eine Runde mit gecachtem
Präfix meist 1–5 Sekunden.

## 5. Smoke-Test

`smoke-test.sh` prüft von aussen über Cloudflare:

- (a) eine Anfrage **ohne** Token wird abgewiesen,
- (b) eine Anfrage **mit** Token liefert JSON,
- (c) ein Tool-Aufruf (`set_timer`) kommt korrekt als `tool_calls` zurück,
- (d) die Latenz von zwei Runden (Tool-Aufruf, dann Antwort mit Tool-Ergebnis), inklusive der
  Prompt-Cache-Statistik von llama-server.

```sh
export LLM_BASE_URL=https://llm.example.ch
export CF_ACCESS_CLIENT_ID=…
export CF_ACCESS_CLIENT_SECRET=…
./smoke-test.sh
```

Benötigt `bash`, `curl` und `python3`. Die Token-Werte werden nicht ausgegeben und nicht als
Kommandozeilenargument übergeben, sondern über eine temporäre Datei (Rechte 600) an `curl`
gereicht und danach gelöscht.

## 6. In Benny eintragen

In der Pebble-App → Benny → Einstellungen:

- **Server URL:** `https://llm.example.ch` (ohne Pfad; Benny hängt `/v1/chat/completions` an)
- **Cloudflare Access Client ID / Client Secret:** aus Schritt 4
- **Model:** `qwen2.5-14b-instruct` (wird mitgeschickt, llama-server ignoriert ihn meist)
- **Request timeout:** 45 s ist ein guter Startwert, höchstens 90 s

Die Werte bleiben in der Pebble-App auf dem Handy und werden nie an die Uhr geschickt.
