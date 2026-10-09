'use strict';

// Pin requests report whether the timeline service took them.
const assert = require('node:assert');
const h = require('./harness');

const NOW = Date.UTC(2026, 9, 9, 7, 30, 0);
const PIN = {id: 'billy-reminder-1', time: '2026-10-09T18:00:00.000Z', layout: {type: 'genericPin', title: 'Tee'}};

function insert() {
    h.setNow(NOW);
    const results = [];
    h.pkjs('actions/timeline').insertUserPin(PIN, (error) => results.push(error));
    return results;
}

function storeReminder(env, id) {
    env.storage.setItem('billy_reminders', JSON.stringify([{id: id, time: '2026-10-09T18:00:00.000Z', what: 'Tee'}]));
}

h.test('an accepted pin calls back once with no error', (env) => {
    const results = insert();
    assert.strictEqual(env.xhrs.length, 1);
    assert.strictEqual(env.xhrs[0].method, 'PUT');
    assert.strictEqual(env.xhrs[0].url, 'https://timeline-api.rebble.io/v1/user/pins/billy-reminder-1');
    assert.strictEqual(env.xhrs[0].headers['X-User-Token'], 'timeline-token');
    env.xhrs[0].respond(200, 'OK');
    env.clock.tick(30000);
    assert.deepStrictEqual(results, [null]);
});

h.test('a refused pin reports the HTTP status', (env) => {
    const results = insert();
    env.xhrs[0].respond(403, '{"error":"invalid token"}');
    assert.deepStrictEqual(results, ['HTTP 403']);
    env.logs.forEach((line) => assert.ok(line.indexOf('timeline-token') === -1, line));
});

h.test('an unreachable timeline service is reported', (env) => {
    const results = insert();
    env.xhrs[0].onerror();
    assert.deepStrictEqual(results, ['timeline service unreachable']);
});

h.test('no answer within 20 seconds counts as failed', (env) => {
    const results = insert();
    env.clock.tick(19999);
    assert.deepStrictEqual(results, []);
    env.clock.tick(1);
    assert.deepStrictEqual(results, ['no answer from the timeline service']);
    assert.strictEqual(env.xhrs[0].aborted, true);
});

h.test('no timeline token means no request', (env) => {
    env.pebble.timelineTokenOk = false;
    const results = insert();
    assert.deepStrictEqual(results, ['no timeline token']);
    assert.strictEqual(env.xhrs.length, 0);
});

h.test('a token that never arrives runs into the timeout', (env) => {
    env.pebble.getTimelineToken = function() {};
    const results = insert();
    env.clock.tick(20000);
    assert.deepStrictEqual(results, ['no answer from the timeline service']);
    assert.strictEqual(env.xhrs.length, 0);
});

h.test('deleting a pin the service does not know counts as done', (env) => {
    h.setNow(NOW);
    const results = [];
    h.pkjs('actions/timeline').deleteUserPin('billy-reminder-1', (error) => results.push(error));
    assert.strictEqual(env.xhrs[0].method, 'DELETE');
    env.xhrs[0].respond(404, '');
    assert.deepStrictEqual(results, [null]);
});

h.test('deleting from the reminder list on the watch tells the user when it fails', (env) => {
    h.setNow(NOW);
    storeReminder(env, 'billy-reminder-1');
    const reminders = h.pkjs('reminders');
    assert.strictEqual(reminders.handleReminderMessage({REMINDER_DELETE: 'billy-reminder-1'}), true);
    env.xhrs[0].respond(502, 'Bad Gateway');
    assert.deepStrictEqual(env.pebble.notifications, [
        {title: 'Buddy', body: 'Reminder not deleted - timeline error. It is still in your timeline.'}
    ]);
    // Still listed, so it can be deleted again.
    assert.strictEqual(h.pkjs('lib/reminders').getAllReminders().length, 1);
    reminders.handleReminderMessage({REMINDER_DELETE: 'billy-reminder-1'});
    env.xhrs[1].respond(200, 'OK');
    assert.strictEqual(env.pebble.notifications.length, 1);
    assert.strictEqual(h.pkjs('lib/reminders').getAllReminders().length, 0);
});
