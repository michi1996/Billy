# Buddy

Buddy ist ein Sprachassistent für Pebble-Uhren von Core Devices (Core Time 2 / Emery), der mit
**deinem eigenen Sprachmodell-Server** spricht: `llama-server` (llama.cpp, z. B. mit
Qwen 2.5 14B) hinter einem Cloudflare Tunnel, geschützt mit einem Cloudflare Access Service Token.

Buddy ist ein Fork von [Billy](https://github.com/TomBolger/Billy), das seinerseits auf
Bobby / Tiny Assistant aus der Rebble- und Pebble-Community aufbaut.

Die App ist eine einzelne PBW und läuft auf **Android und iOS** komplett in PebbleKit JS in der
Pebble-App – ohne Companion-App und ohne fremden Cloud-Dienst.

## Was Buddy kann

- freie Fragen kurz und uhrtauglich beantworten
- Wecker setzen, auflisten, löschen
- Timer setzen, auflisten, löschen
- Erinnerungen als Timeline-Pins setzen, auflisten, löschen
- Uhr-Einstellungen per Sprache ändern (Einheiten, Antwortsprache, Vibration, Quick Launch,
  Bestätigung des Diktats)
- Wetter mit Wetterkarte (Open-Meteo)
- Rückfragen mit Auswahl-Picker auf der Uhr
- einfache Timer und Wecker („Timer 5 Minuten“, „Wecker um 6:45“) sofort und ohne Modell
  (abschaltbar)

## Einrichtung

1. **Server aufsetzen:** siehe [`server/README.md`](server/README.md) – llama-server,
   Cloudflare Tunnel, Access-Policy mit Service Token und `server/smoke-test.sh` zum Prüfen.
2. **PBW bauen und installieren** (siehe unten) oder das PBW-Artefakt aus GitHub Actions nehmen.
3. **Einstellungen** in der Pebble-App → Buddy ausfüllen:
   - *Server URL* – z. B. `https://llm.example.ch` (ohne Pfad)
   - *Cloudflare Access Client ID* und *Client Secret*
   - *Model* – Standard `qwen2.5-14b-instruct`
   - *Request timeout* – 10–90 s, Standard 45 s
   - Sprache, Einheiten und Standortfreigabe nach Wunsch

Ohne konfigurierten Server zeigt die Uhr „Server in den Einstellungen konfigurieren“; einfache
Timer und Wecker funktionieren trotzdem.

### Datenschutz

- Die Service-Token-Werte bleiben in der Pebble-App auf dem Handy. Sie werden nur als
  HTTP-Header an deinen Server geschickt, nie in URLs, Logs oder per AppMessage an die Uhr.
- Anfragen gehen ausschliesslich an deinen Server, Wetterdaten an Open-Meteo, Ortsnamen an
  OpenStreetMap Nominatim, Erinnerungs-Pins an die Pebble-Timeline.
- Mit Standortfreigabe werden die Koordinaten als Kontext an deinen Server geschickt.

## Einschränkungen

- Das Diktat läuft über die Pebble-App auf dem Handy, nicht über deinen Server.
- Höchstens **8 Wecker und Timer** gleichzeitig (Grenze der Pebble-Wakeup-API).
- Erinnerungen kurz in der Zukunft können wegen der Timeline-Synchronisierung verspätet
  ankommen; Buddy weist darauf hin. Erinnerungen brauchen einen Timeline-Token der Pebble-App;
  fehlt er, meldet Buddy das. Ob der Pin danach beim Timeline-Dienst ankommt, prüft Buddy nicht.
- Keine Websuche: Das Modell kennt nur seinen Trainingsstand.
- Cloudflare bricht Anfragen nach 100 Sekunden ab; deshalb maximal 90 s Timeout.

## Entwicklung

PebbleKit JS ist ES5: kein `let`/`const`, keine Arrow-Functions, kein `fetch`, keine Promises.
Ein Test erzwingt das.

```sh
cd app
npm test          # Node-Unit-Tests, keine Abhängigkeiten
pebble build      # schreibt app/build/app.pbw
```

`pebble build` braucht das Pebble SDK, z. B. `pip install pebble-tool` und
`pebble sdk install latest`. Die CI (`.github/workflows/build-pbw.yaml`) führt Tests und Build aus.

### Emulator

Im Emulator spielt Buddy standardmässig aufgezeichnete Antworten ab. Um gegen den echten Server
zu testen:

```sh
pebble install --emulator emery
pebble emu-app-config --emulator emery
```

Auf der Einstellungsseite Server und Token eintragen und unter *Development* „Emulator: use the
real server“ einschalten. Die Werte landen nur im lokalen Speicher des Emulators, nicht im
Repository.

### Aufbau

- `app/src/c/` – Uhr-App (Diktat, Gespräch, Wecker/Timer über die Wakeup-API, Menüs)
- `app/src/pkjs/agent/` – LLM-Client, Agent-Loop, Prompt, Tools, Validierung, Fast-Path
- `app/src/pkjs/actions/` – führt Wecker/Timer/Erinnerungen/Einstellungen auf der Uhr aus
- `app/test/` – Unit-Tests
- `server/` – Server-Doku und Smoke-Test

## Credits

Buddy: Achi.

Buddy ist ein Fork von Billy und Bobby / Tiny Assistant aus der Rebble- und Pebble-Community.
Billy-Entwickler: Thomas Bolger. Grafiken und Icons: Sarah Bolger und Katherine Berry.
Die ursprünglichen Bobby-Credits und die Apache-2.0-Lizenzierung bleiben erhalten.

## Lizenz

Apache 2.0, siehe `LICENSE`.

## Hinweis

Buddy ist kein offizielles Produkt von Pebble, Core Devices, Rebble, Cloudflare oder den
Modell-Anbietern.
