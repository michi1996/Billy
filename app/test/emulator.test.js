'use strict';

const assert = require('node:assert');
const h = require('./harness');

function prompt(env, text) {
    h.pkjs('emulator/emulator_main').main();
    env.pebble.dispatch('appmessage', {payload: {PROMPT: text, THREAD_ID: 'thread-e'}});
}

function withXhr(fn) {
    const xhrs = [];
    h.withGlobal('XMLHttpRequest', function() {
        const xhr = new h.MockXhr();
        xhrs.push(xhr);
        return xhr;
    }, () => h.withGlobal('navigator', {geolocation: {getCurrentPosition: function() {}}}, fn));
    return xhrs;
}

h.test('emulator replays recorded answers by default', (env) => {
    h.settings({LLM_BASE_URL: 'https://llm.example.ch', CF_ACCESS_CLIENT_ID: 'a', CF_ACCESS_CLIENT_SECRET: 'b'});
    const xhrs = withXhr(() => prompt(env, 'What is 47 squared?'));
    assert.strictEqual(xhrs.length, 0);
    assert.ok(env.pebble.sent.some((m) => m.HIGHLIGHT_WIDGET_PRIMARY === '2,209'));
});

h.test('emulator uses the configured server when switched on', (env) => {
    h.settings({LLM_BASE_URL: 'https://llm.example.ch', CF_ACCESS_CLIENT_ID: 'a', CF_ACCESS_CLIENT_SECRET: 'b', EMULATOR_REAL_SERVER: true, FAST_PATH_ENABLED: false});
    const xhrs = withXhr(() => prompt(env, 'What is 47 squared?'));
    assert.strictEqual(xhrs.length, 1);
    assert.strictEqual(xhrs[0].url, 'https://llm.example.ch/v1/chat/completions');
    xhrs[0].respond(200, h.chatResponse({content: '2209'}));
    assert.ok(env.pebble.sent.some((m) => m.CHAT === '2209'));
});
