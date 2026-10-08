'use strict';

const assert = require('node:assert');
const h = require('./harness');
const FakeWatch = require('./fake_watch');

// Wednesday 2026-10-07 21:46:00 CEST.
const NOW = Date.UTC(2026, 9, 7, 19, 46, 0);

function match(prompt, now) {
    h.setNow(now === undefined ? NOW : now);
    return h.pkjs('agent/fast_path').match(prompt, now === undefined ? NOW : now);
}

function iso(ms) {
    return h.pkjs('agent/time_format').formatLocalIso(ms);
}

const timers = [
    ['Timer 5 Minuten', 300, 'de'],
    ['Stell einen Timer auf fünf Minuten.', 300, 'de'],
    ['Stell mir bitte einen Timer für eine halbe Stunde', 1800, 'de'],
    ['Timer für eine halbe Stunde', 1800, 'de'],
    ['Timer für eine Minute', 60, 'de'],
    ['10 Minuten Timer', 600, 'de'],
    ['Zehn-Minuten-Timer', 600, 'de'],
    ['Timer für 45 Sekunden', 45, 'de'],
    ['Timer für fünfundvierzig Sekunden', 45, 'de'],
    ['timer fuer funfundvierzig sekunden', 45, 'de'],
    ['Timer für dreißig Minuten', 1800, 'de'],
    ['Timer für dreissig Minuten', 1800, 'de'],
    ['Timer auf zwölf Minuten stellen', 720, 'de'],
    ['Timer 2 Stunden', 7200, 'de'],
    ['Timer für sechzig Minuten', 3600, 'de'],
    ['Starte einen Timer mit zwanzig Sekunden', 20, 'de'],
    ['Einen Timer für eine Stunde bitte', 3600, 'de'],
    ['Timer 90 Sekunden', 90, 'de'],
    ['Timer 1 Minute', 60, 'de'],
    ['Timer 5 min', 300, 'de'],
    ['Set a timer for 5 minutes', 300, 'en'],
    ['set a timer for twenty seconds.', 20, 'en'],
    ['Timer for half an hour', 1800, 'en'],
    ['Start a 10-minute timer', 600, 'en'],
    ['5 minute timer', 300, 'en'],
    ['Set a timer for an hour please', 3600, 'en'],
    ['timer for forty-five minutes', 2700, 'en'],
    ['Timer for sixty seconds', 60, 'en']
];

timers.forEach((tc) => {
    h.test('timer: "' + tc[0] + '"', () => {
        const m = match(tc[0]);
        assert.ok(m, 'no match');
        assert.strictEqual(m.kind, 'timer');
        assert.strictEqual(m.seconds, tc[1]);
        assert.strictEqual(m.lang, tc[2]);
    });
});

const alarms = [
    // prompt, expected local ISO, tomorrow?
    ['Wecker um 6:45', '2026-10-08T06:45:00+02:00', true],
    ['Wecker um 22:15', '2026-10-07T22:15:00+02:00', false],
    ['Stell einen Wecker für 7 Uhr', '2026-10-08T07:00:00+02:00', true],
    ['Wecker um 7 Uhr 30', '2026-10-08T07:30:00+02:00', true],
    ['Weck mich um 7.30 Uhr', '2026-10-08T07:30:00+02:00', true],
    ['Wecker auf 06:05 stellen', '2026-10-08T06:05:00+02:00', true],
    ['Wecker um 21:46', '2026-10-08T21:46:00+02:00', true],
    ['Wecker um 21:47', '2026-10-07T21:47:00+02:00', false],
    ['Wecker um 23 Uhr', '2026-10-07T23:00:00+02:00', false]
];

alarms.forEach((tc) => {
    h.test('alarm: "' + tc[0] + '"', () => {
        const m = match(tc[0]);
        assert.ok(m, 'no match');
        assert.strictEqual(m.kind, 'alarm');
        assert.strictEqual(iso(m.ms), tc[1]);
        assert.strictEqual(m.tomorrow, tc[2]);
    });
});

const passToLlm = [
    'Wecker um 7',
    'Wecker morgen um 7 Uhr',
    'Wecker am Montag um 7 Uhr',
    'Wecker um 25:00',
    'Wecker um 7:75',
    'set an alarm for 7:30',
    'Timer für 5 Minuten für die Pizza',
    'Pizza-Timer 10 Minuten',
    'Timer 1,5 Stunden',
    'Timer 1 Stunde 30 Minuten',
    'Timer 0 Minuten',
    'Timer 9999 Stunden',
    'Wie lange läuft mein Timer noch?',
    'Lösche den Timer',
    'Erinnere mich in 5 Minuten an den Tee',
    'BILLY_CLARIFICATION_ANSWER\ncontext=x\nquestion=y\nanswer=Timer 5 Minuten',
    'Wie wird das Wetter morgen?',
    ''
];

passToLlm.forEach((prompt) => {
    h.test('not a fast-path command: "' + prompt.replace(/\n/g, ' ') + '"', () => {
        assert.strictEqual(match(prompt), null);
    });
});

h.test('midnight: just before midnight, 0:00 is tomorrow and 23:59 is the next day', () => {
    const lateEvening = Date.UTC(2026, 9, 7, 21, 59, 30); // 23:59:30 local
    const m = match('Wecker um 0:00', lateEvening);
    assert.strictEqual(iso(m.ms), '2026-10-08T00:00:00+02:00');
    assert.strictEqual(m.tomorrow, true);
    assert.strictEqual(iso(match('Wecker um 23:59', lateEvening).ms), '2026-10-08T23:59:00+02:00');
    const afterMidnight = Date.UTC(2026, 9, 7, 22, 0, 30); // 00:00:30 on the 8th
    assert.strictEqual(iso(match('Wecker um 0:01', afterMidnight).ms), '2026-10-08T00:01:00+02:00');
});

h.test('DST end: an alarm the morning after the switch is at 07:00 CET', () => {
    const m = match('Wecker um 7:00', Date.UTC(2026, 9, 24, 20, 0)); // 22:00 CEST
    assert.strictEqual(iso(m.ms), '2026-10-25T07:00:00+01:00');
    assert.strictEqual(m.ms, Date.UTC(2026, 9, 25, 6, 0));
});

h.test('DST start: an alarm the morning after the switch is at 07:00 CEST', () => {
    const m = match('Wecker um 7:00', Date.UTC(2026, 2, 28, 21, 0)); // 22:00 CET
    assert.strictEqual(iso(m.ms), '2026-03-29T07:00:00+02:00');
    // 02:30 does not exist that night; it becomes 03:30 CEST.
    assert.strictEqual(iso(match('Wecker um 2:30', Date.UTC(2026, 2, 28, 21, 0)).ms), '2026-03-29T03:30:00+02:00');
});

function runSession(env, prompt, settings) {
    h.setNow(NOW);
    h.settings(settings || {});
    const watch = new FakeWatch(env, NOW / 1000);
    const Session = h.pkjs('session').Session;
    const Runtime = h.pkjs('agent/runtime').Runtime;
    const client = new h.ScriptedClient([h.parsed(h.chatResponse({content: 'from the model'}))]);
    new Runtime(new Session(prompt, 'thread-f'), {client: client}).run();
    watch.flush();
    return {watch: watch, client: client, chat: env.pebble.sent.filter((m) => 'CHAT' in m).map((m) => m.CHAT).join('')};
}

h.test('fast path sets a timer without a server and confirms in German', (env) => {
    const t = runSession(env, 'Timer 5 Minuten');
    assert.strictEqual(t.client.requests.length, 0);
    assert.strictEqual(t.watch.alarms.length, 1);
    assert.strictEqual(t.watch.alarms[0].time, NOW / 1000 + 300);
    assert.strictEqual(t.chat, 'Timer für 5 Minuten gestellt.');
    assert.strictEqual(env.pebble.sent.filter((m) => 'CHAT_DONE' in m).length, 1);
    const history = h.pkjs('agent/local_history').buildMessages('thread-f');
    assert.deepStrictEqual(history, [{role: 'user', content: 'Timer 5 Minuten'}, {role: 'assistant', content: 'Timer für 5 Minuten gestellt.'}]);
});

h.test('fast path sets an alarm through the validated tool layer', (env) => {
    const t = runSession(env, 'Wecker um 6:45');
    assert.strictEqual(t.watch.alarms[0].time, Date.UTC(2026, 9, 8, 4, 45) / 1000);
    assert.strictEqual(t.watch.alarms[0].isTimer, false);
    assert.strictEqual(t.chat, 'Wecker für morgen 06:45 gestellt.');
});

h.test('reply language follows the setting, otherwise the spoken language', (env) => {
    assert.strictEqual(runSession(env, 'Set a timer for 5 minutes').chat, 'Timer set for 5 minutes.');
    env.pebble.sent = [];
    assert.strictEqual(runSession(env, 'Set a timer for 5 minutes', {LANGUAGE_CODE: 'de_DE'}).chat, 'Timer für 5 Minuten gestellt.');
    env.pebble.sent = [];
    assert.strictEqual(runSession(env, 'Wecker um 22:15', {LANGUAGE_CODE: 'en_US'}).chat, 'Alarm set for today at 22:15.');
    env.pebble.sent = [];
    assert.strictEqual(runSession(env, 'Timer für eine halbe Stunde').chat, 'Timer für 30 Minuten gestellt.');
    env.pebble.sent = [];
    assert.strictEqual(runSession(env, 'Timer 90 Sekunden').chat, 'Timer für 90 Sekunden gestellt.');
    env.pebble.sent = [];
    assert.strictEqual(runSession(env, 'Timer für eine Stunde').chat, 'Timer für 1 Stunde gestellt.');
});

h.test('wakeup errors are shown as a warning', (env) => {
    h.setNow(NOW);
    const watch = new FakeWatch(env, NOW / 1000);
    watch.forcedResult = -7;
    const Session = h.pkjs('session').Session;
    const Runtime = h.pkjs('agent/runtime').Runtime;
    new Runtime(new Session('Timer 5 Minuten', 't'), {client: new h.ScriptedClient([])}).run();
    watch.flush();
    const warnings = env.pebble.sent.filter((m) => 'WARNING' in m).map((m) => m.WARNING);
    assert.deepStrictEqual(warnings, ['At most 8 alarms and timers - delete one first']);
});

h.test('fast path can be switched off', (env) => {
    const t = runSession(env, 'Timer 5 Minuten', {LLM_BASE_URL: 'https://x', CF_ACCESS_CLIENT_ID: 'a', CF_ACCESS_CLIENT_SECRET: 'b', FAST_PATH_ENABLED: false});
    assert.strictEqual(t.client.requests.length, 1);
    assert.strictEqual(t.watch.alarms.length, 0);
    assert.strictEqual(t.chat, 'from the model');
});

h.test('anything else goes to the model', (env) => {
    const t = runSession(env, 'Wecker morgen um 7 Uhr', {LLM_BASE_URL: 'https://x', CF_ACCESS_CLIENT_ID: 'a', CF_ACCESS_CLIENT_SECRET: 'b'});
    assert.strictEqual(t.client.requests.length, 1);
    assert.strictEqual(t.watch.alarms.length, 0);
});
