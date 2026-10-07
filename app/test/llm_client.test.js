'use strict';

const assert = require('node:assert');
const h = require('./harness');

const SECRET_ID = 'cf-id-6d1f0b2a.access';
const SECRET = 'cf-secret-9a8b7c6d5e4f3a2b1c0d';

function configure(extra) {
    h.settings(Object.assign({
        LLM_BASE_URL: 'https://llm.example.ch/',
        CF_ACCESS_CLIENT_ID: SECRET_ID,
        CF_ACCESS_CLIENT_SECRET: SECRET,
        LLM_TIMEOUT_SECONDS: 30
    }, extra || {}));
}

function newClient(xhrs) {
    const client = h.pkjs('agent/llm_client');
    return client.createClient({
        xhrFactory: function() {
            const xhr = new h.MockXhr();
            xhrs.push(xhr);
            return xhr;
        }
    });
}

function request() {
    return {
        messages: [{role: 'system', content: 'sys'}, {role: 'user', content: 'Hallo'}],
        tools: [{type: 'function', 'function': {name: 'set_timer', description: 'x', parameters: {type: 'object', properties: {}}}}]
    };
}

function call(env, respond) {
    const xhrs = [];
    let result = null;
    newClient(xhrs).complete(request(), function(err, value) {
        result = {err: err, value: value};
    });
    if (respond) {
        respond(xhrs[0]);
    }
    return {result: result, xhr: xhrs[0], get: () => result};
}

function assertNoSecretsLogged(env) {
    env.logs.forEach((line) => {
        assert.ok(line.indexOf(SECRET) === -1, 'secret leaked into log: ' + line);
        assert.ok(line.indexOf(SECRET_ID) === -1, 'client id leaked into log: ' + line);
    });
}

h.test('builds the request: URL, headers and body', (env) => {
    configure();
    const xhrs = [];
    newClient(xhrs).complete(request(), function() {});
    const xhr = xhrs[0];
    assert.strictEqual(xhr.method, 'POST');
    assert.strictEqual(xhr.url, 'https://llm.example.ch/v1/chat/completions');
    assert.strictEqual(xhr.async, true);
    assert.strictEqual(xhr.timeout, 30000);
    assert.strictEqual(xhr.headers['Content-Type'], 'application/json');
    assert.strictEqual(xhr.headers['Accept'], 'application/json');
    assert.strictEqual(xhr.headers['CF-Access-Client-Id'], SECRET_ID);
    assert.strictEqual(xhr.headers['CF-Access-Client-Secret'], SECRET);
    assert.ok(xhr.url.indexOf(SECRET) === -1 && xhr.url.indexOf(SECRET_ID) === -1, 'secrets must not be in the URL');
    const body = xhr.json();
    assert.strictEqual(body.model, 'qwen2.5-14b-instruct');
    assert.strictEqual(body.tool_choice, 'auto');
    assert.strictEqual(body.parallel_tool_calls, false);
    assert.strictEqual(body.temperature, 0.2);
    assert.strictEqual(body.max_tokens, 300);
    assert.strictEqual(body.stream, false);
    assert.strictEqual(body.cache_prompt, true);
    assert.deepStrictEqual(body.messages, request().messages);
    assert.deepStrictEqual(body.tools, request().tools);
    assert.ok(JSON.stringify(body).indexOf(SECRET) === -1, 'secret must not be in the body');
    xhr.respond(200, h.chatResponse({content: 'ok'}));
    assertNoSecretsLogged(env);
});

h.test('avoids double slashes and strips a pasted /v1 path', () => {
    configure({LLM_BASE_URL: 'llm.example.ch//v1/chat/completions/'});
    const xhrs = [];
    newClient(xhrs).complete(request(), function() {});
    assert.strictEqual(xhrs[0].url, 'https://llm.example.ch/v1/chat/completions');
});

h.test('passes tool_choice none through', () => {
    configure();
    const xhrs = [];
    const r = request();
    r.toolChoice = 'none';
    newClient(xhrs).complete(r, function() {});
    assert.strictEqual(xhrs[0].json().tool_choice, 'none');
});

h.test('parses a text answer', (env) => {
    configure();
    const c = call(env, (xhr) => xhr.respond(200, h.chatResponse({content: 'Es ist 12 Uhr.'})));
    assert.strictEqual(c.get().err, null);
    assert.strictEqual(c.get().value.content, 'Es ist 12 Uhr.');
    assert.deepStrictEqual(c.get().value.toolCalls, []);
    assertNoSecretsLogged(env);
});

h.test('parses tool calls with JSON string arguments', (env) => {
    configure();
    const c = call(env, (xhr) => xhr.respond(200, h.toolCallResponse('set_timer', {duration_seconds: 300}, 'abc')));
    const value = c.get().value;
    assert.strictEqual(value.toolCalls.length, 1);
    assert.strictEqual(value.toolCalls[0].id, 'abc');
    assert.strictEqual(value.toolCalls[0].name, 'set_timer');
    assert.deepStrictEqual(value.toolCalls[0].arguments, {duration_seconds: 300});
    assert.strictEqual(value.toolCalls[0].argumentsError, null);
});

h.test('keeps broken tool arguments as an error instead of throwing', (env) => {
    configure();
    const c = call(env, (xhr) => xhr.respond(200, h.toolCallResponse('set_timer', '{"duration_seconds": 3')));
    const tc = c.get().value.toolCalls[0];
    assert.strictEqual(tc.arguments, null);
    assert.strictEqual(tc.argumentsError, 'arguments are not valid JSON');
    assert.strictEqual(tc.rawArguments, '{"duration_seconds": 3');
});

h.test('rejects non-object tool arguments', (env) => {
    configure();
    const c = call(env, (xhr) => xhr.respond(200, h.toolCallResponse('set_timer', '[1,2]')));
    assert.strictEqual(c.get().value.toolCalls[0].argumentsError, 'arguments must be a JSON object');
});

h.test('recovers <tool_call> blocks left in the content', (env) => {
    configure();
    const content = '<tool_call>\n{"name": "set_timer", "arguments": {"duration_seconds": 60}}\n</tool_call>';
    const c = call(env, (xhr) => xhr.respond(200, h.chatResponse({content: content})));
    const value = c.get().value;
    assert.strictEqual(value.content, '');
    assert.strictEqual(value.toolCalls[0].name, 'set_timer');
    assert.deepStrictEqual(value.toolCalls[0].arguments, {duration_seconds: 60});
});

const errorCases = [
    ['401', (x) => x.respond(401, '{"error":"no"}'), 'Zugang verweigert – Service Token prüfen'],
    ['403', (x) => x.respond(403, 'Forbidden', {'Content-Type': 'text/plain'}), 'Zugang verweigert – Service Token prüfen'],
    ['HTML login page after redirect (200)', (x) => x.respond(200, '<!DOCTYPE html><html><title>Sign in</title></html>', {'Content-Type': 'text/html; charset=utf-8'}, 'https://team.cloudflareaccess.com/cdn-cgi/access/login'), 'Zugang verweigert – Service Token prüfen'],
    ['HTML without content type', (x) => x.respond(200, '  <html>login</html>', {}), 'Zugang verweigert – Service Token prüfen'],
    ['non-JSON body', (x) => x.respond(200, 'hello', {'Content-Type': 'text/plain'}), 'Zugang verweigert – Service Token prüfen'],
    ['unfollowed redirect', (x) => x.respond(302, '', {}), 'Zugang verweigert – Service Token prüfen'],
    ['524', (x) => x.respond(524, '<html>timeout</html>', {'Content-Type': 'text/html'}), 'Modell hat zu lange gebraucht'],
    ['500', (x) => x.respond(500, '{"error":{"message":"boom"}}'), 'Serverfehler (500)'],
    ['400', (x) => x.respond(400, '{"error":{"message":"context"}}'), 'Serverfehler (400)'],
    ['530 tunnel down', (x) => x.respond(530, '<html>1033</html>', {'Content-Type': 'text/html'}), 'Server nicht erreichbar (530)'],
    ['status 0', (x) => x.respond(0, ''), 'Server nicht erreichbar'],
    ['network error', (x) => x.onerror(), 'Server nicht erreichbar'],
    ['xhr timeout', (x) => x.ontimeout(), 'Server nicht erreichbar'],
    ['JSON without choices', (x) => x.respond(200, '{"object":"chat.completion"}'), 'Ungültige Antwort vom Server']
];

errorCases.forEach((tc) => {
    h.test('maps error: ' + tc[0], (env) => {
        configure();
        const c = call(env, tc[1]);
        assert.ok(c.get(), 'callback was not called');
        assert.ok(c.get().err, 'expected an error');
        assert.strictEqual(c.get().err.message, tc[2]);
        assertNoSecretsLogged(env);
    });
});

h.test('watchdog fires when xhr.timeout is ignored', (env) => {
    configure({LLM_TIMEOUT_SECONDS: 10});
    const c = call(env);
    assert.strictEqual(c.get(), null);
    env.clock.tick(11999);
    assert.strictEqual(c.get(), null);
    env.clock.tick(1);
    assert.strictEqual(c.get().err.message, 'Server nicht erreichbar');
    assert.ok(c.xhr.aborted);
});

h.test('callback fires once even if the watchdog and onload both trigger', (env) => {
    configure({LLM_TIMEOUT_SECONDS: 10});
    let calls = 0;
    const xhrs = [];
    newClient(xhrs).complete(request(), function() { calls++; });
    env.clock.tick(13000);
    xhrs[0].respond(200, h.chatResponse({content: 'late'}));
    assert.strictEqual(calls, 1);
    assert.strictEqual(env.clock.pending(), 0);
});

h.test('missing settings give a configuration message without a request', () => {
    const xhrs = [];
    let err = null;
    newClient(xhrs).complete(request(), function(e) { err = e; });
    assert.strictEqual(xhrs.length, 0);
    assert.strictEqual(err.message, 'Server in den Einstellungen konfigurieren');
    h.settings({LLM_BASE_URL: 'https://llm.example.ch', CF_ACCESS_CLIENT_ID: 'x'});
    newClient(xhrs).complete(request(), function(e) { err = e; });
    assert.strictEqual(xhrs.length, 0);
    assert.strictEqual(err.message, 'Server in den Einstellungen konfigurieren');
});

h.test('timeout setting is clamped to 10-90 seconds', () => {
    const config = h.pkjs('config');
    h.settings({LLM_TIMEOUT_SECONDS: 5});
    assert.strictEqual(config.getLlmTimeoutSeconds(), 10);
    h.settings({LLM_TIMEOUT_SECONDS: 200});
    assert.strictEqual(config.getLlmTimeoutSeconds(), 90);
    h.settings({LLM_TIMEOUT_SECONDS: 'abc'});
    assert.strictEqual(config.getLlmTimeoutSeconds(), 45);
    h.settings({});
    assert.strictEqual(config.getLlmTimeoutSeconds(), 45);
    assert.strictEqual(config.getLlmModel(), 'qwen2.5-14b-instruct');
});
