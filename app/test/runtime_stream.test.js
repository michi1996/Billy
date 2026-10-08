'use strict';

// The agent loop showing answers on the watch while they are being written.
const assert = require('node:assert');
const h = require('./harness');
const FakeWatch = require('./fake_watch');

const NOW = Date.UTC(2026, 9, 7, 19, 46, 0);

function setupRun(env, responses, settings) {
    h.setNow(NOW);
    h.settings(Object.assign({
        LLM_BASE_URL: 'https://llm.example.ch', CF_ACCESS_CLIENT_ID: 'id', CF_ACCESS_CLIENT_SECRET: 'secret',
        LOCATION_ENABLED: false, FAST_PATH_ENABLED: false
    }, settings || {}));
    const watch = new FakeWatch(env, NOW / 1000);
    const Session = h.pkjs('session').Session;
    const Runtime = h.pkjs('agent/runtime').Runtime;
    const session = new Session('Wie wird das Wetter morgen?', 'thread-s');
    const client = new h.ScriptedClient(responses);
    return {watch: watch, client: client, run: () => {
        new Runtime(session, {client: client}).run();
        watch.flush();
    }};
}

// A scripted answer that is handed to onContent in pieces before it completes.
function streamed(text, sizes, extra) {
    return (request) => {
        assert.strictEqual(typeof request.onContent, 'function', 'streaming request expected');
        let i = 0;
        let k = 0;
        while (i < text.length) {
            const size = sizes[k++ % sizes.length];
            request.onContent(text.substring(i, i + size));
            i += size;
        }
        return h.parsed(h.chatResponse(Object.assign({content: text}, extra || {}), extra && extra.tool_calls ? 'tool_calls' : 'stop'));
    };
}

function chats(env) {
    return env.pebble.sent.filter((m) => 'CHAT' in m).map((m) => m.CHAT);
}

// The order of chat pieces, progress lines and bubble ends the watch receives.
function timeline(env) {
    return env.pebble.sent.map((m) => {
        if ('CHAT' in m) return 'chat';
        if ('FUNCTION' in m) return 'progress:' + m.FUNCTION;
        if ('CHAT_DONE' in m) return 'done';
        if ('WARNING' in m) return 'warning';
        return null;
    }).filter((x) => x).filter((x, i, all) => !(x === 'chat' && all[i - 1] === 'chat'));
}

function cleaned(text) {
    return h.pkjs('agent/formatting').forWatch(text);
}

h.test('the answer reaches the watch in pieces while it is written', (env) => {
    const text = 'Morgen wird es in Zürich sonnig und warm. Am Nachmittag bis 24 Grad, am Abend leichter Wind aus Westen.';
    const t = setupRun(env, [streamed(text, [3])]);
    t.run();
    const pieces = chats(env);
    assert.ok(pieces.length >= 3, 'several pieces: ' + JSON.stringify(pieces));
    assert.strictEqual(pieces.join(''), text);
    pieces.slice(0, -1).forEach((piece) => assert.ok(/\s$/.test(piece), 'piece cut inside a word: ' + JSON.stringify(piece)));
    assert.deepStrictEqual(timeline(env), ['progress:Thinking', 'chat', 'done']);
    assert.strictEqual(t.client.requests[0].stream, true);
    assert.strictEqual(env.clock.pending(), 0, 'progress timers must be cleared');
});

h.test('markdown markers are never cut apart', (env) => {
    const text = 'Das ist **sehr** wichtig: `sudo` nur mit _Vorsicht_ verwenden, und **immer** zuerst lesen.';
    const t = setupRun(env, [streamed(text, [1])]);
    t.run();
    const pieces = chats(env);
    assert.ok(pieces.length > 1);
    pieces.forEach((piece) => assert.ok(!/[*_`]/.test(piece), 'raw marker sent: ' + JSON.stringify(piece)));
    assert.strictEqual(pieces.join(''), cleaned(text));
});

h.test('any way of splitting the answer gives exactly the cleaned text', (env) => {
    const texts = [
        '## Wetter\nMorgen:\n* sonnig\n* 24 Grad\n* wenig Wind\n\n\n\nDanach   \nRegen.',
        '  Grüezi! 🍝 Hier sind **drei** Tipps:\n1. Wasser\n2. Salz\n3. Geduld',
        'Kurz.',
        'Eine sehr lange Zeile ohne Satzzeichen die immer weiter geht und weiter und weiter bis sie endlich aufhört'
    ];
    let seed = 7;
    const random = () => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return seed / 2147483648;
    };
    texts.forEach((text) => {
        for (let run = 0; run < 25; run++) {
            const sizes = [];
            for (let i = 0; i < 20; i++) {
                sizes.push(1 + Math.floor(random() * 6));
            }
            env.pebble.sent.length = 0;
            const t = setupRun(env, [streamed(text, sizes)]);
            t.run();
            assert.strictEqual(chats(env).join(''), cleaned(text), JSON.stringify(text) + ' sizes ' + sizes);
        }
    });
});

h.test('a tool call written as text never shows up on the watch', (env) => {
    const inline = '<tool_call>\n{"name": "get_alarms", "arguments": {}}\n</tool_call>';
    const t = setupRun(env, [
        streamed(inline, [2]),
        streamed('Du hast keine Wecker gestellt.', [4])
    ]);
    t.run();
    chats(env).forEach((piece) => assert.ok(piece.indexOf('<') === -1 && piece.indexOf('get_alarms') === -1, piece));
    assert.strictEqual(chats(env).join(''), 'Du hast keine Wecker gestellt.');
    assert.strictEqual(t.client.requests.length, 2);
});

h.test('text before a tool call gets its own bubble, the answer follows in a new one', (env) => {
    const t = setupRun(env, [
        streamed('Ich schaue kurz nach.', [3], {
            tool_calls: [{id: 'call_1', type: 'function', 'function': {name: 'get_alarms', arguments: '{}'}}]
        }),
        streamed('Du hast keine Wecker gestellt.', [5])
    ]);
    t.run();
    assert.strictEqual(chats(env).join(''), 'Ich schaue kurz nach.Du hast keine Wecker gestellt.');
    assert.deepStrictEqual(timeline(env), [
        'progress:Thinking', 'chat', 'done', 'progress:Thinking', 'progress:Checking your alarms',
        'progress:Writing the answer', 'chat', 'done'
    ]);
    assert.strictEqual(env.clock.pending(), 0);
});

h.test('a failed streamed request is asked again without streaming', (env) => {
    const failure = new Error('Server error (500): streaming not supported');
    failure.kind = 'server_error';
    const t = setupRun(env, [failure, h.parsed(h.chatResponse({content: 'Hallo!'}))]);
    t.run();
    assert.strictEqual(t.client.requests.length, 2);
    assert.strictEqual(t.client.requests[0].stream, true);
    assert.strictEqual(t.client.requests[1].stream, false);
    assert.deepStrictEqual(chats(env), ['Hallo!']);
});

h.test('other errors are not retried', (env) => {
    const failure = new Error('Server unreachable');
    failure.kind = 'unreachable';
    const t = setupRun(env, [failure]);
    t.run();
    assert.strictEqual(t.client.requests.length, 1);
    assert.deepStrictEqual(env.pebble.sent.filter((m) => 'WARNING' in m).map((m) => m.WARNING), ['Server unreachable']);
});

h.test('an error after some text keeps the text and adds the warning', (env) => {
    const failure = new Error('Server unreachable');
    failure.kind = 'unreachable';
    const t = setupRun(env, [(request) => {
        request.onContent('Morgen wird es sonnig. Am ');
        return failure;
    }]);
    t.run();
    assert.strictEqual(t.client.requests.length, 1);
    assert.deepStrictEqual(chats(env), ['Morgen wird es sonnig. ']);
    assert.deepStrictEqual(timeline(env), ['progress:Thinking', 'chat', 'warning', 'done']);
});

h.test('streaming can be switched off in the settings', (env) => {
    const t = setupRun(env, [h.parsed(h.chatResponse({content: 'Hallo!'}))], {STREAM_ANSWERS: false});
    t.run();
    assert.strictEqual(t.client.requests[0].stream, false);
    assert.deepStrictEqual(chats(env), ['Hallo!']);
});
