'use strict';

const assert = require('node:assert');
const h = require('./harness');
const FakeWatch = require('./fake_watch');

// Wednesday 2026-10-07 21:46:00 in Zurich (CEST, UTC+02:00).
const NOW = Date.UTC(2026, 9, 7, 19, 46, 0);

function setupRun(env, responses, prompt, threadId) {
    h.setNow(NOW);
    h.settings({LLM_BASE_URL: 'https://llm.example.ch', CF_ACCESS_CLIENT_ID: 'id', CF_ACCESS_CLIENT_SECRET: 'secret', LOCATION_ENABLED: false, FAST_PATH_ENABLED: false});
    const watch = new FakeWatch(env, NOW / 1000);
    const Session = h.pkjs('session').Session;
    const Runtime = h.pkjs('agent/runtime').Runtime;
    const session = new Session(prompt || 'Stell einen Timer auf 5 Minuten', threadId || 'thread-1');
    const client = new h.ScriptedClient(responses);
    return {watch: watch, session: session, client: client, run: () => {
        new Runtime(session, {client: client}).run();
        watch.flush();
    }};
}

function sentKeys(env, key) {
    return env.pebble.sent.filter((m) => key in m).map((m) => m[key]);
}

h.test('one tool call, its result, then the final answer', (env) => {
    const t = setupRun(env, [
        h.parsed(h.toolCallResponse('set_timer', {duration_seconds: 300}, 'call_a')),
        h.parsed(h.chatResponse({content: 'Timer auf 5 Minuten gestellt.'}))
    ]);
    t.run();
    assert.strictEqual(t.client.requests.length, 2);
    assert.strictEqual(t.watch.alarms.length, 1);
    assert.strictEqual(t.watch.alarms[0].isTimer, true);
    assert.strictEqual(t.watch.alarms[0].time, NOW / 1000 + 300);

    const second = t.client.requests[1];
    assert.strictEqual(second.toolChoice, 'auto');
    const assistant = second.messages[second.messages.length - 2];
    assert.strictEqual(assistant.role, 'assistant');
    assert.strictEqual(assistant.tool_calls[0].id, 'call_a');
    assert.strictEqual(assistant.tool_calls[0].type, 'function');
    assert.strictEqual(assistant.tool_calls[0]['function'].name, 'set_timer');
    assert.strictEqual(assistant.tool_calls[0]['function'].arguments, '{"duration_seconds":300}');
    const tool = second.messages[second.messages.length - 1];
    assert.strictEqual(tool.role, 'tool');
    assert.strictEqual(tool.tool_call_id, 'call_a');
    assert.deepStrictEqual(JSON.parse(tool.content), {status: 'ok'});

    assert.deepStrictEqual(sentKeys(env, 'CHAT'), ['Timer auf 5 Minuten gestellt.']);
    assert.strictEqual(sentKeys(env, 'CHAT_DONE').length, 1);
    assert.deepStrictEqual(sentKeys(env, 'CLOSE_WAS_CLEAN'), [true]);
    assert.strictEqual(env.clock.pending(), 0, 'progress timers must be cleared');
});

h.test('stops after three tool rounds and forces an answer', (env) => {
    const always = () => h.parsed(h.toolCallResponse('get_alarms', {}));
    const t = setupRun(env, [always, always, always, always], 'Welche Wecker habe ich?');
    t.run();
    assert.strictEqual(t.client.requests.length, 4);
    assert.deepStrictEqual(t.client.requests.map((r) => r.toolChoice), ['auto', 'auto', 'auto', 'none']);
    assert.strictEqual(sentKeys(env, 'GET_ALARM_OR_TIMER').length, 3, 'tools run in exactly three rounds');
    assert.deepStrictEqual(sentKeys(env, 'CHAT'), ['Sorry, I could not finish that request.']);
    assert.strictEqual(sentKeys(env, 'CHAT_DONE').length, 1);
});

h.test('forced last round uses the text answer when there is one', (env) => {
    const call = () => h.parsed(h.toolCallResponse('get_alarms', {}));
    const t = setupRun(env, [call, call, call, h.parsed(h.chatResponse({content: 'Du hast keine Wecker.'}))]);
    t.run();
    assert.deepStrictEqual(sentKeys(env, 'CHAT'), ['Du hast keine Wecker.']);
});

h.test('broken tool arguments go back to the model as a tool error', (env) => {
    const t = setupRun(env, [
        h.parsed(h.toolCallResponse('set_timer', '{"duration_seconds": 30', 'call_x')),
        h.parsed(h.toolCallResponse('set_timer', {duration_seconds: 30}, 'call_y')),
        h.parsed(h.chatResponse({content: 'Erledigt.'}))
    ]);
    t.run();
    const toolMessage = t.client.requests[1].messages.slice(-1)[0];
    assert.strictEqual(toolMessage.tool_call_id, 'call_x');
    const result = JSON.parse(toolMessage.content);
    assert.strictEqual(result.status, 'error');
    assert.ok(/not valid JSON/.test(result.error));
    assert.strictEqual(t.watch.alarms.length, 1, 'only the corrected call sets a timer');
    assert.deepStrictEqual(sentKeys(env, 'CHAT'), ['Erledigt.']);
});

h.test('server errors are shown as a warning and the session closes cleanly', (env) => {
    const err = new Error('Access denied - check the service token');
    const t = setupRun(env, [err]);
    t.run();
    assert.deepStrictEqual(sentKeys(env, 'WARNING'), ['Access denied - check the service token']);
    assert.strictEqual(sentKeys(env, 'CHAT_DONE').length, 1);
    assert.deepStrictEqual(sentKeys(env, 'CLOSE_WAS_CLEAN'), [true]);
    assert.strictEqual(env.clock.pending(), 0);
});

h.test('without a configured server the watch gets a configuration message', (env) => {
    h.setNow(NOW);
    global.XMLHttpRequest = function() {
        throw new Error('no request may be made');
    };
    try {
        const Session = h.pkjs('session').Session;
        new Session('Wie spät ist es in Tokio?', 'thread-2').run();
    } finally {
        delete global.XMLHttpRequest;
    }
    assert.deepStrictEqual(sentKeys(env, 'WARNING'), ['Set up the server in the app settings']);
    assert.strictEqual(sentKeys(env, 'CHAT_DONE').length, 1);
});

h.test('clarifying question stops the loop and shows the picker', (env) => {
    const t = setupRun(env, [
        h.parsed(h.toolCallResponse('ask_clarifying_question', {question: 'Welcher Wecker?', options: ['07:00', '07:30']}))
    ], 'Lösch meinen Wecker');
    t.run();
    assert.strictEqual(t.client.requests.length, 1);
    const picker = env.pebble.sent.find((m) => m.CLARIFY_WIDGET === 1);
    assert.ok(picker, 'picker was sent');
    assert.strictEqual(picker.CLARIFY_QUESTION, 'Welcher Wecker?');
    assert.strictEqual(picker.CLARIFY_OPTION_COUNT, 2);
    assert.strictEqual(sentKeys(env, 'CLOSE_WAS_CLEAN').length, 0);
});

h.test('long answers are streamed in chunks of at most 80 characters', (env) => {
    const text = 'Dies ist eine lange Antwort, die auf der Uhr in mehreren Teilen ankommen muss, damit nichts verloren geht. Zweiter Satz folgt hier.';
    const t = setupRun(env, [h.parsed(h.chatResponse({content: text}))]);
    t.run();
    const chunks = sentKeys(env, 'CHAT');
    assert.ok(chunks.length >= 2);
    chunks.forEach((c) => assert.ok(c.length <= 80, 'chunk too long: ' + c.length));
    assert.strictEqual(chunks.join(''), text);
});

h.test('markdown is stripped for the watch', (env) => {
    const t = setupRun(env, [h.parsed(h.chatResponse({content: '**Morgen** wird es *sonnig*.'}))]);
    t.run();
    assert.deepStrictEqual(sentKeys(env, 'CHAT'), ['Morgen wird es sonnig.']);
});

h.test('thread history: earlier turns are sent as chat messages, only the last three', (env) => {
    const answers = [];
    for (let i = 1; i <= 5; i++) {
        answers.push(h.parsed(h.chatResponse({content: 'Antwort ' + i})));
    }
    const t = setupRun(env, answers, 'Frage 1', 'thread-h');
    t.run();
    const Session = h.pkjs('session').Session;
    const Runtime = h.pkjs('agent/runtime').Runtime;
    for (let i = 2; i <= 5; i++) {
        new Runtime(new Session('Frage ' + i, 'thread-h'), {client: t.client}).run();
    }
    const last = t.client.requests[4].messages;
    assert.strictEqual(last[0].role, 'system');
    const history = last.slice(1, -1);
    assert.deepStrictEqual(history.map((m) => m.role + ':' + m.content), [
        'user:Frage 2', 'assistant:Antwort 2',
        'user:Frage 3', 'assistant:Antwort 3',
        'user:Frage 4', 'assistant:Antwort 4'
    ]);
    assert.ok(/\nFrage 5$/.test(last[last.length - 1].content));
});

h.test('a new conversation gets a thread id', (env) => {
    h.setNow(NOW);
    h.settings({LLM_BASE_URL: 'https://x', CF_ACCESS_CLIENT_ID: 'a', CF_ACCESS_CLIENT_SECRET: 'b'});
    const Session = h.pkjs('session').Session;
    const Runtime = h.pkjs('agent/runtime').Runtime;
    const client = new h.ScriptedClient([h.parsed(h.chatResponse({content: 'Hallo'}))]);
    new Runtime(new Session('Hallo', undefined), {client: client}).run();
    const ids = sentKeys(env, 'THREAD_ID');
    assert.strictEqual(ids.length, 1);
    assert.ok(/^[0-9a-f-]{36}$/.test(ids[0]));
});
