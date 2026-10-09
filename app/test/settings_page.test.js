'use strict';

const assert = require('node:assert');
const h = require('./harness');

const SECRET_ID = 'id-0123456789.access';
const SECRET = 'secret-abcdefabcdefabcdef';

// Behaves like Clay: generateUrl reads localStorage, getSettings flattens and stores the response.
function FakeClay(storage) {
    this.storage = storage;
    this.pageSettings = null;
}
FakeClay.prototype.generateUrl = function() {
    this.pageSettings = JSON.parse(this.storage.getItem('clay-settings'));
    return 'data:text/html;charset=utf-8,' + encodeURIComponent(JSON.stringify(this.pageSettings));
};
FakeClay.prototype.getSettings = function(response) {
    const parsed = JSON.parse(/^\{/.test(response) ? response : decodeURIComponent(response));
    const flat = {};
    Object.keys(parsed).forEach((key) => {
        flat[key] = parsed[key].value;
    });
    this.storage.setItem('clay-settings', JSON.stringify(flat));
    return parsed;
};

function pageResponse(values) {
    const result = {};
    Object.keys(values).forEach((key) => {
        result[key] = {value: values[key]};
    });
    return encodeURIComponent(JSON.stringify(result));
}

const ALL = {
    LLM_BASE_URL: 'https://llm.example.ch',
    CF_ACCESS_CLIENT_ID: SECRET_ID,
    CF_ACCESS_CLIENT_SECRET: SECRET,
    LLM_MODEL: 'qwen2.5-14b-instruct',
    LLM_TIMEOUT_SECONDS: 45,
    FAST_PATH_ENABLED: true,
    LANGUAGE_CODE: 'de_DE',
    UNIT_PREFERENCE: 'metric',
    ALARM_VIBE_PATTERN: '2',
    TIMER_VIBE_PATTERN: '3',
    QUICK_LAUNCH_BEHAVIOUR: '1',
    CONFIRM_TRANSCRIPTS: true,
    LOCATION_ENABLED: true,
    EMULATOR_REAL_SERVER: false
};

function install(env) {
    const clay = new FakeClay(env.storage);
    h.pkjs('settings_page').install(clay, env.storage, env.pebble);
    return clay;
}

h.test('the config page never receives stored secrets', (env) => {
    h.settings(ALL);
    const clay = install(env);
    env.pebble.dispatch('showConfiguration', {});
    assert.strictEqual(env.pebble.openedUrls.length, 1);
    const url = decodeURIComponent(env.pebble.openedUrls[0]);
    assert.ok(url.indexOf(SECRET) === -1 && url.indexOf(SECRET_ID) === -1, 'secret in config URL');
    assert.strictEqual(clay.pageSettings.CF_ACCESS_CLIENT_SECRET, '__buddy_unchanged__');
    assert.strictEqual(clay.pageSettings.LLM_BASE_URL, 'https://llm.example.ch');
    // localStorage is back to the real values afterwards.
    assert.strictEqual(JSON.parse(env.storage.getItem('clay-settings')).CF_ACCESS_CLIENT_SECRET, SECRET);
});

h.test('saving only sends the allowlisted watch settings', (env) => {
    h.settings({});
    install(env);
    env.pebble.dispatch('webviewclosed', {response: pageResponse(ALL)});
    assert.strictEqual(env.pebble.sent.length, 1);
    assert.deepStrictEqual(env.pebble.sent[0], {
        QUICK_LAUNCH_BEHAVIOUR: '1',
        ALARM_VIBE_PATTERN: '2',
        TIMER_VIBE_PATTERN: '3',
        CONFIRM_TRANSCRIPTS: 1,
        QUICK_PROMPTS_LANG: 'de',
        QUICK_PROMPTS_CUSTOM: ''
    });
    const json = JSON.stringify(env.pebble.sent);
    assert.ok(json.indexOf(SECRET) === -1 && json.indexOf(SECRET_ID) === -1);
    assert.strictEqual(JSON.parse(env.storage.getItem('clay-settings')).CF_ACCESS_CLIENT_SECRET, SECRET);
    env.logs.forEach((line) => assert.ok(line.indexOf(SECRET) === -1, line));
});

h.test('an unchanged placeholder keeps the secret, an empty field clears it', (env) => {
    h.settings(ALL);
    install(env);
    const unchanged = Object.assign({}, ALL, {CF_ACCESS_CLIENT_ID: '__buddy_unchanged__', CF_ACCESS_CLIENT_SECRET: '__buddy_unchanged__', LLM_MODEL: 'other'});
    env.pebble.dispatch('webviewclosed', {response: pageResponse(unchanged)});
    let stored = JSON.parse(env.storage.getItem('clay-settings'));
    assert.strictEqual(stored.CF_ACCESS_CLIENT_ID, SECRET_ID);
    assert.strictEqual(stored.CF_ACCESS_CLIENT_SECRET, SECRET);
    assert.strictEqual(stored.LLM_MODEL, 'other');
    const cleared = Object.assign({}, unchanged, {CF_ACCESS_CLIENT_SECRET: ''});
    env.pebble.dispatch('webviewclosed', {response: pageResponse(cleared)});
    stored = JSON.parse(env.storage.getItem('clay-settings'));
    assert.strictEqual(stored.CF_ACCESS_CLIENT_SECRET, '');
    assert.strictEqual(stored.CF_ACCESS_CLIENT_ID, SECRET_ID);
});

h.test('cancelling the page changes nothing', (env) => {
    h.settings(ALL);
    install(env);
    env.pebble.dispatch('webviewclosed', {response: ''});
    assert.strictEqual(env.pebble.sent.length, 0);
    assert.strictEqual(JSON.parse(env.storage.getItem('clay-settings')).CF_ACCESS_CLIENT_SECRET, SECRET);
});

h.test('secret Clay fields are password inputs and not AppMessage keys', () => {
    const config = require('../src/pkjs/config.json');
    const items = [].concat.apply([], config.filter((s) => s.items).map((s) => s.items));
    ['CF_ACCESS_CLIENT_ID', 'CF_ACCESS_CLIENT_SECRET', 'LLM_API_KEY'].forEach((key) => {
        const item = items.find((i) => i.messageKey === key);
        assert.ok(item, key + ' missing');
        assert.strictEqual(item.attributes.type, 'password');
        assert.ok(!(key in h.messageKeys), key + ' must not be a package.json messageKey');
    });
    ['LLM_BASE_URL', 'LLM_MODEL', 'LLM_TIMEOUT_SECONDS', 'FAST_PATH_ENABLED', 'STREAM_ANSWERS', 'EMULATOR_REAL_SERVER'].forEach((key) => {
        assert.ok(items.find((i) => i.messageKey === key), key + ' missing');
        assert.ok(!(key in h.messageKeys), key + ' must not be sent to the watch');
    });
    h.pkjs('settings_page').WATCH_KEYS.forEach((key) => {
        assert.ok(key in h.messageKeys, key + ' must be a package.json messageKey');
    });
});

h.test('values that would break the config page travel encoded and come back unchanged', (env) => {
    const risky = "Was sind 5$' in CHF? </script>\u2028ok";
    h.settings(Object.assign({}, ALL, {CUSTOM_PROMPT_1: risky, CUSTOM_PROMPT_2: 'harmlos'}));
    const clay = install(env);
    env.pebble.dispatch('showConfiguration', {});
    const page = h.pkjs('settings_page');
    const sent = clay.pageSettings.CUSTOM_PROMPT_1;
    assert.ok(sent.indexOf(page.PAGE_ENCODED_PREFIX) === 0, sent);
    assert.ok(!/[$<>\u2028\u2029]/.test(sent), 'still risky: ' + sent);
    assert.strictEqual(clay.pageSettings.CUSTOM_PROMPT_2, 'harmlos');
    assert.strictEqual(JSON.parse(env.storage.getItem('clay-settings')).CUSTOM_PROMPT_1, risky);
    // The page normally decodes it; if it comes back encoded anyway, it is decoded on save.
    env.pebble.dispatch('webviewclosed', {response: pageResponse(Object.assign({}, ALL, {CUSTOM_PROMPT_1: sent}))});
    assert.strictEqual(JSON.parse(env.storage.getItem('clay-settings')).CUSTOM_PROMPT_1, risky);
    env.pebble.dispatch('webviewclosed', {response: pageResponse(Object.assign({}, ALL, {CUSTOM_PROMPT_1: risky}))});
    assert.strictEqual(JSON.parse(env.storage.getItem('clay-settings')).CUSTOM_PROMPT_1, risky);
});

h.test('the API key is treated like the service token on the config page', (env) => {
    const KEY = 'sk-llama-0f9e8d7c6b5a';
    h.settings(Object.assign({}, ALL, {LLM_API_KEY: KEY}));
    const clay = install(env);
    env.pebble.dispatch('showConfiguration', {});
    assert.strictEqual(clay.pageSettings.LLM_API_KEY, '__buddy_unchanged__');
    assert.ok(decodeURIComponent(env.pebble.openedUrls[0]).indexOf(KEY) === -1);
    env.pebble.dispatch('webviewclosed', {response: pageResponse(Object.assign({}, ALL, {LLM_API_KEY: '__buddy_unchanged__'}))});
    assert.strictEqual(JSON.parse(env.storage.getItem('clay-settings')).LLM_API_KEY, KEY);
    assert.ok(JSON.stringify(env.pebble.sent).indexOf(KEY) === -1, 'API key sent to the watch');
});
