'use strict';

const assert = require('node:assert');
const h = require('./harness');
const FakeWatch = require('./fake_watch');

const NOW = Date.UTC(2026, 9, 9, 7, 30, 0);
const SECRET = 'cf-secret-9a8b7c6d5e4f3a2b1c0d';

function configure(extra) {
    h.setNow(NOW);
    h.settings(Object.assign({
        LLM_BASE_URL: 'https://llm.example.ch',
        CF_ACCESS_CLIENT_ID: 'cf-id.access',
        CF_ACCESS_CLIENT_SECRET: SECRET,
        LOCATION_ENABLED: false,
        FAST_PATH_ENABLED: false
    }, extra || {}));
}

h.test('the warm-up starts exactly like a real request', (env) => {
    configure();
    // What a real question sends first.
    new FakeWatch(env, NOW / 1000);
    const Session = h.pkjs('session').Session;
    const client = new h.ScriptedClient([h.parsed(h.chatResponse({content: 'Hallo!'}))]);
    new (h.pkjs('agent/runtime').Runtime)(new Session('Wie spät ist es?', 't'), {client: client}).run();
    const real = client.requests[0];
    const warm = h.pkjs('warmup').buildRequest();
    assert.deepStrictEqual(warm.messages[0], real.messages[0]);
    assert.strictEqual(JSON.stringify(warm.tools), JSON.stringify(real.tools));
    assert.strictEqual(warm.toolChoice, real.toolChoice);
    assert.strictEqual(warm.maxTokens, 1);
    assert.strictEqual(warm.stream, false);
});

h.test('the warm-up goes to the server with the access headers and one token', (env) => {
    configure();
    let outcome = null;
    h.pkjs('warmup').run({storage: env.storage}, (result) => {
        outcome = result;
    });
    assert.strictEqual(env.xhrs.length, 1);
    const xhr = env.xhrs[0];
    assert.strictEqual(xhr.url, 'https://llm.example.ch/v1/chat/completions');
    assert.strictEqual(xhr.headers['CF-Access-Client-Secret'], SECRET);
    const body = xhr.json();
    assert.strictEqual(body.max_tokens, 1);
    assert.strictEqual(body.cache_prompt, true);
    assert.strictEqual(body.messages[0].role, 'system');
    h.setNow(NOW + 6500);
    xhr.respond(200, h.chatResponse({content: 'H'}, 'length'));
    assert.strictEqual(outcome, 'done');
    assert.ok(env.logs.indexOf('Warm-up done in 6500 ms.') !== -1, env.logs.join('\n'));
    assert.strictEqual(env.pebble.sent.length, 0, 'nothing goes to the watch');
    env.logs.forEach((line) => assert.ok(line.indexOf(SECRET) === -1, line));
});

h.test('opening Buddy again within a minute does not warm up again', (env) => {
    configure();
    const warmup = h.pkjs('warmup');
    const results = [];
    warmup.run({storage: env.storage}, (r) => results.push(r));
    env.xhrs[0].respond(200, h.chatResponse({content: 'H'}));
    h.setNow(NOW + 59000);
    warmup.run({storage: env.storage}, (r) => results.push(r));
    h.setNow(NOW + 61000);
    warmup.run({storage: env.storage}, (r) => results.push(r));
    assert.deepStrictEqual(results, ['done', 'recent']);
    assert.strictEqual(env.xhrs.length, 2);
});

h.test('no warm-up without a configured server', (env) => {
    configure({CF_ACCESS_CLIENT_SECRET: ''});
    let outcome = null;
    h.pkjs('warmup').run({storage: env.storage}, (r) => {
        outcome = r;
    });
    assert.strictEqual(outcome, 'not_configured');
    assert.strictEqual(env.xhrs.length, 0);
});

h.test('a failed warm-up is only logged', (env) => {
    configure();
    let outcome = null;
    h.pkjs('warmup').run({storage: env.storage}, (r) => {
        outcome = r;
    });
    env.xhrs[0].onerror();
    assert.strictEqual(outcome, 'failed');
    assert.strictEqual(env.pebble.sent.length, 0);
    assert.ok(env.logs.indexOf('Warm-up failed: Server unreachable') !== -1);
});
