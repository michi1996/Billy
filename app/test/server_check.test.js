'use strict';

const assert = require('node:assert');
const h = require('./harness');

const SECRET_ID = 'id-0123456789.access';
const SECRET = 'secret-abcdefabcdefabcdef';

const SERVER = {
    LLM_BASE_URL: 'https://llm.example.ch',
    CF_ACCESS_CLIENT_ID: SECRET_ID,
    CF_ACCESS_CLIENT_SECRET: SECRET,
    LLM_MODEL: 'qwen2.5-14b-instruct',
    LLM_TIMEOUT_SECONDS: 45
};

function FakeClay(storage) {
    this.storage = storage;
    this.meta = {userData: {}};
    this.pageMeta = null;
}
FakeClay.prototype.generateUrl = function() {
    this.pageMeta = JSON.parse(JSON.stringify(this.meta));
    return 'data:text/html,page';
};
FakeClay.prototype.getSettings = function(response) {
    const parsed = JSON.parse(decodeURIComponent(response));
    const flat = {};
    Object.keys(parsed).forEach((key) => {
        flat[key] = parsed[key].value;
    });
    this.storage.setItem('clay-settings', JSON.stringify(flat));
    return parsed;
};

function save(env, values) {
    const response = {};
    Object.keys(values).forEach((key) => {
        response[key] = {value: values[key]};
    });
    env.pebble.dispatch('webviewclosed', {response: encodeURIComponent(JSON.stringify(response))});
}

function install(env) {
    const clay = new FakeClay(env.storage);
    h.pkjs('settings_page').install(clay, env.storage, env.pebble);
    return clay;
}

function assertNoSecrets(env) {
    const texts = env.logs.concat(env.pebble.notifications.map((n) => n.body))
        .concat([env.storage.getItem('buddy-server-check') || '']);
    texts.forEach((text) => {
        assert.ok(text.indexOf(SECRET) === -1 && text.indexOf(SECRET_ID) === -1, 'secret leaked: ' + text);
    });
}

h.test('saving new server settings checks the server with a tiny request', (env) => {
    const start = Date.UTC(2026, 9, 8, 12, 0);
    h.setNow(start);
    h.settings({});
    install(env);
    save(env, SERVER);
    assert.strictEqual(env.xhrs.length, 1);
    const xhr = env.xhrs[0];
    assert.strictEqual(xhr.url, 'https://llm.example.ch/v1/chat/completions');
    assert.strictEqual(xhr.headers['CF-Access-Client-Id'], SECRET_ID);
    assert.strictEqual(xhr.headers['CF-Access-Client-Secret'], SECRET);
    const body = xhr.json();
    assert.strictEqual(body.model, 'qwen2.5-14b-instruct');
    assert.strictEqual(body.max_tokens, 1);
    assert.deepStrictEqual(body.messages, [{role: 'user', content: 'Hi'}]);
    assert.ok(!('tools' in body) && !('tool_choice' in body) && !('parallel_tool_calls' in body));
    h.setNow(start + 800);
    xhr.respond(200, Object.assign(h.chatResponse({content: 'Hello'}, 'length'), {model: 'qwen2.5-14b-instruct'}));
    assert.deepStrictEqual(env.pebble.notifications, [{title: 'Buddy', body: 'Server OK\nqwen2.5-14b-instruct, 0.8 s'}]);
    assertNoSecrets(env);
});

h.test('a failed check names the problem on the watch', (env) => {
    h.settings({});
    install(env);
    save(env, SERVER);
    env.xhrs[0].respond(400, {error: {code: 400, message: "model 'qwen2.5-14b-instruct' not found", type: 'invalid_request_error'}});
    assert.deepStrictEqual(env.pebble.notifications, [{
        title: 'Buddy',
        body: "Server check failed\nServer error (400): model 'qwen2.5-14b-instruct' not found"
    }]);
    assertNoSecrets(env);
});

h.test('an Access login page means the token is wrong', (env) => {
    h.settings({});
    install(env);
    save(env, SERVER);
    env.xhrs[0].respond(200, '<!DOCTYPE html><html>Sign in</html>', {'Content-Type': 'text/html'},
        'https://team.cloudflareaccess.com/cdn-cgi/access/login');
    assert.strictEqual(env.pebble.notifications[0].body, 'Server check failed\nAccess denied - check the service token');
    assertNoSecrets(env);
});

h.test('an unreachable server is reported', (env) => {
    h.settings({});
    install(env);
    save(env, SERVER);
    env.xhrs[0].onerror();
    assert.strictEqual(env.pebble.notifications[0].body, 'Server check failed\nServer unreachable');
});

h.test('saving without server changes after a good check does not check again', (env) => {
    h.settings({});
    install(env);
    save(env, SERVER);
    env.xhrs[0].respond(200, h.chatResponse({content: 'Hi'}));
    save(env, Object.assign({}, SERVER, {
        CF_ACCESS_CLIENT_ID: '__buddy_unchanged__',
        CF_ACCESS_CLIENT_SECRET: '__buddy_unchanged__',
        ALARM_VIBE_PATTERN: '2'
    }));
    assert.strictEqual(env.xhrs.length, 1);
    assert.strictEqual(env.pebble.notifications.length, 1);
});

h.test('saving again after a failed check retries, a changed model checks again', (env) => {
    h.settings({});
    install(env);
    save(env, SERVER);
    env.xhrs[0].onerror();
    const unchanged = Object.assign({}, SERVER, {CF_ACCESS_CLIENT_ID: '__buddy_unchanged__', CF_ACCESS_CLIENT_SECRET: '__buddy_unchanged__'});
    save(env, unchanged);
    assert.strictEqual(env.xhrs.length, 2);
    env.xhrs[1].respond(200, h.chatResponse({content: 'Hi'}));
    save(env, Object.assign({}, unchanged, {LLM_MODEL: 'other-model'}));
    assert.strictEqual(env.xhrs.length, 3);
    assert.strictEqual(env.xhrs[2].json().model, 'other-model');
});

h.test('no check without a complete server configuration, or when the page is cancelled', (env) => {
    h.settings({});
    install(env);
    save(env, {LLM_BASE_URL: 'https://llm.example.ch', CF_ACCESS_CLIENT_ID: '', CF_ACCESS_CLIENT_SECRET: ''});
    env.pebble.dispatch('webviewclosed', {response: ''});
    assert.strictEqual(env.xhrs.length, 0);
    assert.strictEqual(env.pebble.notifications.length, 0);
});

h.test('the settings page gets the last result without secrets or page-breaking characters', (env) => {
    h.settings({});
    const clay = install(env);
    env.pebble.dispatch('showConfiguration', {});
    assert.deepStrictEqual(clay.pageMeta.userData, {serverCheck: null});
    save(env, SERVER);
    env.xhrs[0].respond(400, {error: {message: "model '<x>$&' not found"}});
    env.pebble.dispatch('showConfiguration', {});
    const check = clay.pageMeta.userData.serverCheck;
    assert.strictEqual(check.ok, false);
    assert.strictEqual(check.message, "Server error (400): model 'x&' not found");
    assert.ok(check.time > 0);
    assert.ok(JSON.stringify(clay.pageMeta).indexOf(SECRET) === -1);
});

h.test('a changed API key checks the server again', (env) => {
    h.settings({});
    install(env);
    save(env, SERVER);
    env.xhrs[0].respond(200, h.chatResponse({content: 'Hi'}));
    const unchanged = Object.assign({}, SERVER, {CF_ACCESS_CLIENT_ID: '__buddy_unchanged__', CF_ACCESS_CLIENT_SECRET: '__buddy_unchanged__'});
    save(env, Object.assign({}, unchanged, {LLM_API_KEY: 'sk-new-key'}));
    assert.strictEqual(env.xhrs.length, 2);
    assert.strictEqual(env.xhrs[1].headers['Authorization'], 'Bearer sk-new-key');
    env.xhrs[1].respond(401, {error: {code: 401, message: 'Invalid API Key', type: 'authentication_error'}});
    assert.strictEqual(env.pebble.notifications[1].body, 'Server check failed\nAccess denied - check the API key');
    assert.ok(env.logs.every((line) => line.indexOf('sk-new-key') === -1));
});
