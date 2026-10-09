'use strict';

const assert = require('node:assert');
const h = require('./harness');
const FakeWatch = require('./fake_watch');

function configure(extra) {
    h.settings(Object.assign({
        LLM_BASE_URL: 'https://llm.example.ch',
        CF_ACCESS_CLIENT_ID: 'id',
        CF_ACCESS_CLIENT_SECRET: 'secret',
        LOCATION_ENABLED: true,
        LANGUAGE_CODE: 'de_DE'
    }, extra || {}));
}

function runOnce(env, prompt, threadId, nowMs) {
    h.setNow(nowMs);
    const Session = h.pkjs('session').Session;
    const Runtime = h.pkjs('agent/runtime').Runtime;
    const client = new h.ScriptedClient([h.parsed(h.chatResponse({content: 'ok'}))]);
    new Runtime(new Session(prompt, threadId), {client: client}).run();
    return client.requests[0];
}

h.test('system prompt and tools are byte-identical across requests', (env) => {
    configure();
    new FakeWatch(env, 0);
    env.storage.setItem('oldLat', '47.3769');
    env.storage.setItem('oldLon', '8.5417');
    const first = runOnce(env, 'Wie wird das Wetter?', 'thread-a', Date.UTC(2026, 9, 7, 19, 46));
    const second = runOnce(env, 'Stell einen Wecker um 7', 'thread-b', Date.UTC(2026, 9, 8, 5, 3));
    assert.strictEqual(first.messages[0].role, 'system');
    assert.strictEqual(JSON.stringify(first.messages[0]), JSON.stringify(second.messages[0]));
    assert.strictEqual(JSON.stringify(first.tools), JSON.stringify(second.tools));
    // Time-dependent data lives in the user message, not in the system prompt.
    assert.ok(first.messages[0].content.indexOf('2026-10-07') === -1);
    assert.ok(first.messages[0].content.indexOf('21:46') === -1);
    assert.ok(first.messages[0].content.indexOf('47.37') === -1);
    assert.notStrictEqual(first.messages[1].content, second.messages[1].content);
});

h.test('tool list is fixed and in a fixed order', (env) => {
    configure();
    const first = runOnce(env, 'Hallo', 't1', Date.UTC(2026, 9, 7, 19, 46));
    const weather = runOnce(env, 'Brauche ich einen Schirm?', 't2', Date.UTC(2026, 9, 7, 19, 47));
    const names = first.tools.map((t) => t['function'].name);
    assert.deepStrictEqual(names, [
        'ask_clarifying_question', 'get_weather',
        'set_alarm', 'get_alarms', 'delete_alarm',
        'set_timer', 'get_timers', 'delete_timer',
        'set_reminder', 'get_reminders', 'delete_reminder',
        'update_settings'
    ]);
    assert.deepStrictEqual(weather.tools, first.tools);
    first.tools.forEach((tool) => {
        assert.strictEqual(tool.type, 'function');
        assert.strictEqual(tool['function'].parameters.type, 'object');
        assert.ok(JSON.stringify(tool).indexOf('int32') === -1);
    });
});

h.test('the new user message starts with a context line', (env) => {
    configure();
    const request = runOnce(env, 'Wecker morgen um 7', 't', Date.UTC(2026, 9, 7, 19, 46));
    const user = request.messages[request.messages.length - 1];
    assert.strictEqual(user.role, 'user');
    const lines = user.content.split('\n');
    assert.ok(/^\[Context\] now=2026-10-07T21:46\+02:00 Wednesday; tomorrow=2026-10-08 Thursday; timezone=(Europe\/Zurich )?UTC\+02:00; location=/.test(lines[0]), lines[0]);
    assert.strictEqual(lines[1], 'Wecker morgen um 7');
});

h.test('context line flags a different offset tomorrow (end of DST)', (env) => {
    configure();
    const request = runOnce(env, 'Wecker morgen um 7', 't', Date.UTC(2026, 9, 24, 18, 0));
    const line = request.messages[request.messages.length - 1].content.split('\n')[0];
    assert.ok(line.indexOf('now=2026-10-24T20:00+02:00 Saturday; tomorrow=2026-10-25 Sunday (UTC+01:00)') !== -1, line);
});

h.test('context line includes a fresh location when allowed', (env) => {
    configure();
    const now = Date.UTC(2026, 9, 7, 19, 46);
    env.storage.setItem('oldLat', '47.37694');
    env.storage.setItem('oldLon', '8.54167');
    env.storage.setItem('oldAccuracy', '25');
    env.storage.setItem('oldLocationUpdatedAt', String(Date.now()));
    h.withGlobal('navigator', {geolocation: {getCurrentPosition: function() {}}}, () => {
        h.pkjs('location').update();
    });
    h.pkjs('agent/clock').now = () => Date.now();
    const line = h.pkjs('agent/prompt').buildContextLine(Date.now());
    assert.ok(/location=47\.3769,8\.5417 \(±25 m\)$/.test(line), line);
    configure({LOCATION_ENABLED: false});
    assert.ok(/location=unknown$/.test(h.pkjs('agent/prompt').buildContextLine(now)));
});

h.test('language and units setting change the system prompt', (env) => {
    configure({LANGUAGE_CODE: '', UNIT_PREFERENCE: ''});
    const prompt = h.pkjs('agent/prompt');
    assert.ok(prompt.buildSystemPrompt().indexOf("Reply in the language of the user's message.") !== -1);
    configure({LANGUAGE_CODE: 'de_DE', UNIT_PREFERENCE: 'metric'});
    assert.ok(prompt.buildSystemPrompt().indexOf('Always reply in German (de_DE).') !== -1);
    assert.ok(prompt.buildSystemPrompt().indexOf('Use metric units.') !== -1);
    ['Gemini', 'Google', 'grounding', 'companion', 'profile', 'map'].forEach((word) => {
        assert.ok(prompt.buildSystemPrompt().toLowerCase().indexOf(word.toLowerCase()) === -1, 'prompt mentions ' + word);
    });
});
