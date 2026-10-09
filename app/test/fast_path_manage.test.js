'use strict';

// Asking about and deleting timers and alarms without the model.
const assert = require('node:assert');
const h = require('./harness');
const FakeWatch = require('./fake_watch');

// Wednesday 2026-10-07 21:46:00 CEST.
const NOW = Date.UTC(2026, 9, 7, 19, 46, 0);
const NOW_S = NOW / 1000;
// Local (Zurich, CEST) wall-clock time as epoch seconds.
const local = (day, hour, minute) => Date.UTC(2026, 9, day, hour - 2, minute) / 1000;

function match(prompt) {
    h.setNow(NOW);
    const m = h.pkjs('agent/fast_path').match(prompt, NOW);
    return m && {kind: m.kind, what: m.what, lang: m.lang};
}

const recognised = [
    ['Welche Timer habe ich?', 'list', 'timer', 'de'],
    ['Welche Wecker sind gestellt?', 'list', 'alarm', 'de'],
    ['Zeig mir meine Wecker', 'list', 'alarm', 'de'],
    ['Meine Timer', 'list', 'timer', 'de'],
    ['Hab ich einen Wecker gestellt?', 'list', 'alarm', 'de'],
    ['Wie lange läuft mein Timer noch?', 'list', 'timer', 'de'],
    ['Wie viel Zeit hat der Timer noch?', 'list', 'timer', 'de'],
    ['Lösch den Timer', 'delete', 'timer', 'de'],
    ['Lösche bitte meinen Wecker', 'delete', 'alarm', 'de'],
    ['Stopp den Timer', 'delete', 'timer', 'de'],
    ['Brich den Timer ab', 'delete', 'timer', 'de'],
    ['Timer abbrechen', 'delete', 'timer', 'de'],
    ['Wecker ausschalten', 'delete', 'alarm', 'de'],
    ['Lösche alle Timer', 'delete_all', 'timer', 'de'],
    ['Alle Wecker löschen', 'delete_all', 'alarm', 'de'],
    ['Lösch den Wecker um 6:45', 'delete_at', 'alarm', 'de'],
    ['Lösche den Wecker um 7 Uhr', 'delete_at', 'alarm', 'de'],
    ['What alarms do I have?', 'list', 'alarm', 'en'],
    ['Show my timers', 'list', 'timer', 'en'],
    ['Do I have any alarms set?', 'list', 'alarm', 'en'],
    ['How long is left on my timer?', 'list', 'timer', 'en'],
    ['How much time is left on the timer?', 'list', 'timer', 'en'],
    ['Cancel my timer', 'delete', 'timer', 'en'],
    ['Turn off the alarm', 'delete', 'alarm', 'en'],
    ['Delete all alarms', 'delete_all', 'alarm', 'en'],
    ['Cancel all my timers', 'delete_all', 'timer', 'en'],
    ['Delete the alarm at 6:45 am', 'delete_at', 'alarm', 'en'],
    ['Remove my alarm at 7:30', 'delete_at', 'alarm', 'en']
];

recognised.forEach((tc) => {
    h.test('recognised: "' + tc[0] + '"', () => {
        assert.deepStrictEqual(match(tc[0]), {kind: tc[1], what: tc[2], lang: tc[3]});
    });
});

['Lösch den Pasta-Timer', 'Welche Timer hatte ich gestern?', 'Stopp', 'Wie lange noch?', 'Delete everything',
    'Lösch den Wecker um 25:00', 'Delete the alarm at 13 pm', 'Cancel my timer and set a new one'].forEach((prompt) => {
    h.test('left to the model: "' + prompt + '"', () => {
        assert.strictEqual(match(prompt), null);
    });
});

function run(env, prompt, alarms, settings) {
    h.setNow(NOW);
    h.settings(settings || {});
    const watch = new FakeWatch(env, NOW_S);
    watch.alarms = (alarms || []).map((a) => Object.assign({name: ''}, a));
    const Session = h.pkjs('session').Session;
    const client = new h.ScriptedClient([h.parsed(h.chatResponse({content: 'from the model'}))]);
    new (h.pkjs('agent/runtime').Runtime)(new Session(prompt, 'thread-m'), {client: client}).run();
    watch.flush();
    return {watch: watch, client: client, chat: env.pebble.sent.filter((m) => 'CHAT' in m).map((m) => m.CHAT).join('')};
}

h.test('no timers', (env) => {
    const t = run(env, 'Welche Timer habe ich?');
    assert.strictEqual(t.chat, 'Du hast keinen Timer gestellt.');
    assert.strictEqual(t.client.requests.length, 0);
});

h.test('one timer with its time left', (env) => {
    const t = run(env, 'Wie lange läuft mein Timer noch?', [{time: NOW_S + 272, isTimer: true, name: 'Pasta'}]);
    assert.strictEqual(t.chat, 'Dein Timer (Pasta) läuft noch 4:32.');
    assert.strictEqual(t.client.requests.length, 0);
    assert.deepStrictEqual(h.pkjs('agent/local_history').buildMessages('thread-m'), [
        {role: 'user', content: 'Wie lange läuft mein Timer noch?'},
        {role: 'assistant', content: 'Dein Timer (Pasta) läuft noch 4:32.'}
    ]);
});

h.test('several timers, soonest first, in English', (env) => {
    const t = run(env, 'How long is left on my timer?', [
        {time: NOW_S + 3725, isTimer: true},
        {time: NOW_S + 90, isTimer: true, name: 'Tea'},
        {time: local(8, 7, 0), isTimer: false}
    ]);
    assert.strictEqual(t.chat, 'You have 2 timers:\n- 1:30 left (Tea)\n- 1:02:05 left');
});

h.test('alarms with today, tomorrow, weekday and date', (env) => {
    const alarms = [
        {time: local(14, 8, 0), isTimer: false},
        {time: local(7, 22, 15), isTimer: false},
        {time: local(8, 6, 45), isTimer: false, name: 'Arbeit'},
        {time: local(10, 9, 30), isTimer: false}
    ];
    assert.strictEqual(run(env, 'Welche Wecker sind gestellt?', alarms).chat,
        'Du hast 4 Wecker:\n- heute 22:15\n- morgen 06:45 (Arbeit)\n- am Samstag 09:30\n- am 14.10. 08:00');
    env.pebble.sent = [];
    assert.strictEqual(run(env, 'What alarms do I have?', alarms).chat,
        'You have 4 alarms:\n- today at 10:15 PM\n- tomorrow at 6:45 AM (Arbeit)\n- on Saturday at 9:30 AM\n- on Oct 14 at 8:00 AM');
    env.pebble.sent = [];
    assert.strictEqual(run(env, 'Hab ich einen Wecker?', [alarms[2]]).chat, 'Dein Wecker (Arbeit) klingelt morgen um 06:45.');
    env.pebble.sent = [];
    assert.strictEqual(run(env, 'Hab ich einen Wecker?', [alarms[0]]).chat, 'Dein Wecker klingelt am 14.10. um 08:00.');
    env.pebble.sent = [];
    assert.strictEqual(run(env, 'Do I have an alarm?', [alarms[3]]).chat, 'Your alarm goes off on Saturday at 9:30 AM.');
});

h.test('deleting the only timer', (env) => {
    const t = run(env, 'Lösch den Timer', [{time: NOW_S + 300, isTimer: true}, {time: local(8, 7, 0), isTimer: false}]);
    assert.strictEqual(t.chat, 'Timer gelöscht.');
    assert.deepStrictEqual(t.watch.alarms.map((a) => a.isTimer), [false]);
    assert.strictEqual(t.client.requests.length, 0);
});

h.test('deleting when there is none', (env) => {
    const t = run(env, 'Cancel my timer');
    assert.strictEqual(t.chat, 'You have no timers set.');
});

h.test('deleting one of several hands over to the model', (env) => {
    const t = run(env, 'Stopp den Timer', [{time: NOW_S + 300, isTimer: true}, {time: NOW_S + 600, isTimer: true}],
        {LLM_BASE_URL: 'https://x', CF_ACCESS_CLIENT_ID: 'a', CF_ACCESS_CLIENT_SECRET: 'b'});
    assert.strictEqual(t.client.requests.length, 1);
    assert.strictEqual(t.watch.alarms.length, 2);
    assert.strictEqual(t.chat, 'from the model');
});

h.test('deleting all timers', (env) => {
    const t = run(env, 'Lösche alle Timer', [
        {time: NOW_S + 300, isTimer: true}, {time: NOW_S + 600, isTimer: true}, {time: local(8, 7, 0), isTimer: false}
    ]);
    assert.strictEqual(t.chat, 'Alle 2 Timer gelöscht.');
    assert.deepStrictEqual(t.watch.alarms.map((a) => a.isTimer), [false]);
});

h.test('deleting an alarm by its time', (env) => {
    const alarms = [{time: local(8, 6, 45), isTimer: false}, {time: local(8, 7, 30), isTimer: false}];
    const t = run(env, 'Lösch den Wecker um 6:45', alarms);
    assert.strictEqual(t.chat, 'Wecker für morgen 06:45 gelöscht.');
    assert.deepStrictEqual(t.watch.alarms.map((a) => a.time), [local(8, 7, 30)]);
    env.pebble.sent = [];
    assert.strictEqual(run(env, 'Lösche den Wecker um 9 Uhr', alarms).chat, 'Du hast keinen Wecker um 09:00.');
});

h.test('"7:30" without am/pm finds the 19:30 alarm', (env) => {
    const t = run(env, 'Remove my alarm at 7:30', [{time: local(8, 19, 30), isTimer: false}]);
    assert.strictEqual(t.chat, 'Alarm for tomorrow at 7:30 PM deleted.');
    assert.strictEqual(t.watch.alarms.length, 0);
    env.pebble.sent = [];
    assert.strictEqual(run(env, 'Delete the alarm at 6:45 am', []).chat, 'You have no alarm at 6:45 AM.');
});

h.test('replies follow the language setting', (env) => {
    const t = run(env, 'Show my timers', [{time: NOW_S + 60, isTimer: true}], {LANGUAGE_CODE: 'de_DE'});
    assert.strictEqual(t.chat, 'Dein Timer läuft noch 1:00.');
});
