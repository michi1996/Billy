'use strict';

// Streamed answers (server-sent events) in the LLM client.
const assert = require('node:assert');
const h = require('./harness');

const SECRET_ID = 'cf-id-6d1f0b2a.access';
const SECRET = 'cf-secret-9a8b7c6d5e4f3a2b1c0d';

function configure() {
    h.settings({
        LLM_BASE_URL: 'https://llm.example.ch',
        CF_ACCESS_CLIENT_ID: SECRET_ID,
        CF_ACCESS_CLIENT_SECRET: SECRET,
        LLM_TIMEOUT_SECONDS: 30
    });
}

// What llama-server sends: a role chunk, content or tool call deltas, a finish chunk, [DONE].
function sse(deltas, finishReason) {
    const chunk = (delta, finish) => ({
        id: 'chatcmpl-1', object: 'chat.completion.chunk', model: 'qwen2.5-14b-instruct',
        choices: [{index: 0, delta: delta, finish_reason: finish || null}]
    });
    const events = [chunk({role: 'assistant', content: null})]
        .concat(deltas.map((d) => chunk(d)))
        .concat([chunk({}, finishReason || 'stop')]);
    return events.map((e) => 'data: ' + JSON.stringify(e) + '\n\n').join('') + 'data: [DONE]\n\n';
}

function textDeltas(text, size) {
    const deltas = [];
    for (let i = 0; i < text.length; i += size) {
        deltas.push({content: text.substring(i, i + size)});
    }
    return deltas;
}

function start(onContent, extra) {
    const xhrs = [];
    const result = {value: null, err: null, calls: 0, texts: []};
    const client = h.pkjs('agent/llm_client').createClient({
        xhrFactory: () => {
            const xhr = new h.MockXhr();
            xhrs.push(xhr);
            return xhr;
        }
    });
    client.complete(Object.assign({
        messages: [{role: 'user', content: 'Hallo'}],
        tools: [{type: 'function', 'function': {name: 'get_weather', description: 'x', parameters: {type: 'object', properties: {}}}}],
        stream: true,
        onContent: (text) => {
            result.texts.push(text);
            if (onContent) {
                onContent(text);
            }
        }
    }, extra || {}), (err, value) => {
        result.calls++;
        result.err = err;
        result.value = value;
    });
    return {xhr: xhrs[0], result: result};
}

// Delivers `body` in pieces of `size` characters through progress events, then completes.
function deliver(xhr, body, size, headers) {
    xhr.status = 200;
    xhr.readyState = 3;
    for (let end = size; end < body.length; end += size) {
        xhr.responseText = body.substring(0, end);
        xhr.onprogress();
    }
    xhr.respond(200, body, headers || {'Content-Type': 'text/event-stream'});
}

function assertNoSecretsLogged(env) {
    env.logs.forEach((line) => {
        assert.ok(line.indexOf(SECRET) === -1 && line.indexOf(SECRET_ID) === -1, 'secret leaked: ' + line);
    });
}

h.test('a streamed request asks for events and has no overall timeout', (env) => {
    configure();
    const t = start();
    assert.strictEqual(t.xhr.json().stream, true);
    assert.strictEqual(t.xhr.headers['Accept'], 'text/event-stream');
    assert.strictEqual(t.xhr.timeout, 0);
    assert.ok(t.xhr.url.indexOf(SECRET) === -1 && t.xhr.sentBody.indexOf(SECRET) === -1);
});

h.test('text arrives piece by piece and the result is the whole answer', (env) => {
    configure();
    const text = 'Morgen wird es sonnig und warm, bis 24 Grad.';
    const seen = [];
    const t = start((piece) => seen.push(t.result.calls));
    deliver(t.xhr, sse(textDeltas(text, 5)), 37);
    assert.strictEqual(t.result.texts.join(''), text);
    assert.ok(t.result.texts.length > 3, 'several pieces');
    assert.ok(seen.every((calls) => calls === 0), 'pieces must arrive before the end');
    assert.strictEqual(t.result.calls, 1);
    assert.strictEqual(t.result.err, null);
    assert.strictEqual(t.result.value.content, text);
    assert.strictEqual(t.result.value.finishReason, 'stop');
    assert.strictEqual(t.result.value.model, 'qwen2.5-14b-instruct');
    assertNoSecretsLogged(env);
});

h.test('any split of the event stream gives the same answer', (env) => {
    configure();
    const text = 'Grüezi! Das sind 3 Punkte:\n- eins\n- zwei 🍝\n- drei';
    const body = sse(textDeltas(text, 3));
    [1, 2, 7, 13, 64, body.length].forEach((size) => {
        const t = start();
        deliver(t.xhr, body, size);
        assert.strictEqual(t.result.texts.join(''), text, 'size ' + size);
        assert.strictEqual(t.result.value.content, text, 'size ' + size);
    });
});

h.test('streamed tool calls are put together from their pieces', (env) => {
    configure();
    const body = sse([
        {tool_calls: [{index: 0, id: 'call_x', type: 'function', 'function': {name: 'get_weather', arguments: ''}}]},
        {tool_calls: [{index: 0, 'function': {arguments: '{"loca'}}]},
        {tool_calls: [{index: 0, 'function': {arguments: 'tion": "Zürich"}'}}]}
    ], 'tool_calls');
    const t = start();
    deliver(t.xhr, body, 11);
    assert.deepStrictEqual(t.result.texts, []);
    const calls = t.result.value.toolCalls;
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].id, 'call_x');
    assert.strictEqual(calls[0].name, 'get_weather');
    assert.deepStrictEqual(calls[0].arguments, {location: 'Zürich'});
    assert.strictEqual(t.result.value.finishReason, 'tool_calls');
});

h.test('a server that ignores stream and sends plain JSON still works', (env) => {
    configure();
    const t = start();
    t.xhr.respond(200, h.chatResponse({content: 'Hallo!'}));
    assert.strictEqual(t.result.value.content, 'Hallo!');
    assert.deepStrictEqual(t.result.texts, []);
});

h.test('an error event during generation becomes a server error', (env) => {
    configure();
    const body = sse(textDeltas('Hal', 3)).replace('data: [DONE]\n\n',
        'error: {"code":500,"message":"context size exceeded","type":"server_error"}\n\n');
    const t = start();
    deliver(t.xhr, body, 20);
    assert.strictEqual(t.result.err.kind, 'server_error');
    assert.strictEqual(t.result.err.message, 'Server error: context size exceeded');
});

h.test('the Access login page is not mistaken for text', (env) => {
    configure();
    const t = start();
    deliver(t.xhr, '<!DOCTYPE html><html><body>Sign in with Cloudflare Access</body></html>', 10,
        {'Content-Type': 'text/html'});
    assert.deepStrictEqual(t.result.texts, []);
    assert.strictEqual(t.result.err.kind, 'access_denied');
});

h.test('HTTP errors are reported as before', (env) => {
    configure();
    const t = start();
    t.xhr.respond(400, {error: {code: 400, message: 'tools param requires --jinja flag'}});
    assert.strictEqual(t.result.err.kind, 'server_error');
    assert.strictEqual(t.result.err.message, 'Server error (400): tools param requires --jinja flag');
});

h.test('the watchdog restarts while text keeps coming and fires when it stalls', (env) => {
    configure();
    const t = start();
    const body = sse(textDeltas('Eins zwei drei vier fünf sechs', 4));
    t.xhr.status = 200;
    t.xhr.readyState = 3;
    // 30 s timeout + 2 s grace; send something every 20 s for a minute.
    for (let i = 1; i <= 3; i++) {
        env.clock.tick(20000);
        t.xhr.responseText = body.substring(0, i * 60);
        t.xhr.onprogress();
    }
    assert.strictEqual(t.result.calls, 0, 'still running after 60 s');
    env.clock.tick(31999);
    assert.strictEqual(t.result.calls, 0);
    env.clock.tick(1);
    assert.strictEqual(t.result.calls, 1);
    assert.strictEqual(t.result.err.kind, 'unreachable');
    assert.strictEqual(t.xhr.aborted, true);
});

h.test('requests without stream keep the old behaviour', (env) => {
    configure();
    const t = start(null, {stream: false});
    assert.strictEqual(t.xhr.json().stream, false);
    assert.strictEqual(t.xhr.headers['Accept'], 'application/json');
    assert.strictEqual(t.xhr.timeout, 30000);
    t.xhr.respond(200, h.chatResponse({content: 'Hallo!'}));
    assert.strictEqual(t.result.value.content, 'Hallo!');
});
