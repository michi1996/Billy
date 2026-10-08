# Buddy

Buddy is a voice assistant for Core Devices Pebble watches (Core Time 2 / Emery) that talks to
**your own language model server**: `llama-server` (llama.cpp, e.g. with Qwen 2.5 14B) behind a
Cloudflare Tunnel, protected by a Cloudflare Access service token.

Buddy is a fork of [Billy](https://github.com/TomBolger/Billy), which in turn builds on
Bobby / Tiny Assistant from the Rebble and Pebble community.

The app is a single PBW and runs on **Android and iOS** entirely in PebbleKit JS inside the
Pebble app – no companion app and no third-party cloud service.

## What Buddy can do

- answer questions briefly, sized for the watch
- show the answer on the watch while the model is still writing it (Pebble app on Android; on
  iPhone the app hands over the answer in one piece)
- set, list and delete alarms
- set, list and delete timers
- show a live countdown for the next timer (and the time of the next alarm) under Buddy in the
  app list, updated by the watch itself
- set, list and delete reminders as timeline pins
- change watch settings by voice (units, response language, vibration, quick launch,
  dictation confirmation)
- weather with a weather card (Open-Meteo)
- follow-up questions with an option picker on the watch
- simple timers and alarms ("Set a timer for 5 minutes", "Set an alarm for 6:45 am") instantly,
  without the model (can be switched off; ambiguous times like "7:30" without am/pm go to the model)

## Setup

1. **Set up the server:** see [`server/README.md`](server/README.md) – llama-server,
   Cloudflare Tunnel, an Access policy with a service token, and `server/smoke-test.sh` to check it.
2. **Build and install the PBW** (see below), or take the PBW artifact from GitHub Actions.
3. **Fill in the settings** in the Pebble app → Buddy:
   - *Server URL* – e.g. `https://llm.example.com` (no path)
   - *Cloudflare Access Client ID* and *Client Secret*
   - *Model* – default `qwen2.5-14b-instruct`
   - *Request timeout* – 10–90 s, default 45 s
   - language, units and location access as you like
   - *Quick prompts* – the suggestions behind the Up button on the start screen: Automatic
     (follows the response language, then the phone's language), English, Deutsch, Français,
     Italiano, or Custom with up to six of your own prompts

When you save changed server settings, Buddy sends a one-word test request and shows the result
on the watch ("Server OK" with the model and response time, or what went wrong). The settings page
shows the last result at the top of the Server card.

Without a configured server the watch shows "Set up the server in the app settings"; simple
timers and alarms still work.

### Privacy

- The service token values stay in the Pebble app on the phone. They are only sent as HTTP
  headers to your server, never in URLs, logs or AppMessages to the watch.
- Requests go only to your server; weather data comes from Open-Meteo, place names are looked
  up with OpenStreetMap Nominatim, and reminder pins go to the Pebble timeline.
- With location access enabled, your coordinates are sent to your server as context.

## Limitations

- Dictation runs through the Pebble app on the phone, not through your server.
- At most **8 alarms and timers** at the same time (limit of the Pebble wakeup API).
- Reminders shortly in the future can arrive late because of timeline sync; Buddy warns about
  this. Reminders need a timeline token from the Pebble app; if it is missing, Buddy says so.
  Buddy does not check whether the pin actually reaches the timeline service.
- No web search: the model only knows what it was trained on.
- Cloudflare cuts requests off after 100 seconds, so the timeout is at most 90 s.

## Development

PebbleKit JS is ES5: no `let`/`const`, no arrow functions, no `fetch`, no Promises.
A test enforces this.

```sh
cd app
npm test          # Node unit tests, no dependencies
pebble build      # writes app/build/app.pbw
```

`pebble build` needs the Pebble SDK, e.g. `pip install pebble-tool` and
`pebble sdk install latest`. CI (`.github/workflows/build-pbw.yaml`) runs the tests and the build.

### Emulator

By default the emulator replays recorded answers. To test against the real server:

```sh
pebble install --emulator emery
pebble emu-app-config --emulator emery
```

Enter the server and token on the settings page and turn on "Emulator: use the real server"
under *Development*. The values only end up in the emulator's local storage, not in the
repository.

### Layout

- `app/src/c/` – watch app (dictation, conversation, alarms/timers via the wakeup API, menus)
- `app/src/pkjs/agent/` – LLM client, agent loop, prompt, tools, validation, fast path
- `app/src/pkjs/actions/` – runs alarm/timer/reminder/settings actions on the watch
- `app/test/` – unit tests
- `server/` – server docs and smoke test

## Credits

Buddy: Achi.

Buddy is a fork of Billy and Bobby / Tiny Assistant from the Rebble and Pebble community.
Billy developer: Thomas Bolger. Artwork and iconography: Sarah Bolger and Katherine Berry.
The original Bobby credits and Apache 2.0 licensing are preserved.

## License

Apache 2.0; see `LICENSE`.

## Disclaimer

Buddy is not an official product of Pebble, Core Devices, Rebble, Cloudflare or any model
provider.
