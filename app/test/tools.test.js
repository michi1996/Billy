'use strict';

const assert = require('node:assert');
const h = require('./harness');
const FakeWatch = require('./fake_watch');

const NOW = Date.UTC(2026, 9, 7, 19, 46, 0);

function setup(env) {
    h.setNow(NOW);
    const watch = new FakeWatch(env, NOW / 1000);
    const Session = h.pkjs('session').Session;
    const session = new Session('test', 'thread');
    const xhrs = [];
    return {
        watch: watch,
        session: session,
        xhrs: xhrs,
        exec: function(name, args) {
            let result;
            h.withGlobal('XMLHttpRequest', function() {
                const xhr = new h.MockXhr();
                xhrs.push(xhr);
                return xhr;
            }, () => {
                h.pkjs('agent/tools').execute(session, {id: 'c', name: name, arguments: args, argumentsError: null}, (r) => {
                    result = r;
                });
                watch.flush();
            });
            return result;
        }
    };
}

h.test('set_alarm sends the validated time to the watch', (env) => {
    const t = setup(env);
    const result = t.exec('set_alarm', {time: '2026-10-08T07:00:00+02:00', name: 'Arbeit'});
    assert.deepStrictEqual(result, {status: 'ok'});
    const request = t.watch.messages('SET_ALARM_TIME')[0];
    assert.strictEqual(request.SET_ALARM_TIME, Date.UTC(2026, 9, 8, 5, 0) / 1000);
    assert.strictEqual(request.SET_ALARM_IS_TIMER, false);
    assert.strictEqual(request.SET_ALARM_NAME, 'Arbeit');
});

h.test('invalid arguments never reach the watch', (env) => {
    const t = setup(env);
    const result = t.exec('set_alarm', {time: '2026-10-07T08:00:00+02:00'});
    assert.strictEqual(result.status, 'error');
    assert.ok(/in the past/.test(result.error));
    assert.strictEqual(t.watch.messages('SET_ALARM_TIME').length, 0);
});

h.test('the eight-wakeup limit is reported to model and user', (env) => {
    const t = setup(env);
    for (let i = 0; i < 8; i++) {
        assert.deepStrictEqual(t.exec('set_timer', {duration_seconds: 60 + i}), {status: 'ok'});
    }
    const result = t.exec('set_timer', {duration_seconds: 600});
    assert.strictEqual(result.error, 'The limit of eight alarms was already reached.');
    assert.strictEqual(result.user_message, 'At most 8 alarms and timers - delete one first');
});

h.test('a wakeup collision gets a user message too', (env) => {
    const t = setup(env);
    t.watch.forcedResult = -8;
    const result = t.exec('set_alarm', {time: '2026-10-08T07:00:00+02:00'});
    assert.strictEqual(result.user_message, 'Something is already scheduled on the watch at that time');
});

h.test('get_timers and delete_timer round trip', (env) => {
    const t = setup(env);
    t.exec('set_timer', {duration_seconds: 300, name: 'Pizza'});
    const list = t.exec('get_timers', {});
    assert.strictEqual(list.status, 'ok');
    assert.strictEqual(list.timers.length, 1);
    assert.strictEqual(list.timers[0].name, 'Pizza');
    assert.strictEqual(list.timers[0].secondsLeft, 300);
    const deleted = t.exec('delete_timer', {time: list.timers[0].expirationTimeForDeletingAndWidgets});
    assert.deepStrictEqual(deleted, {status: 'ok'});
    assert.strictEqual(t.watch.alarms.length, 0);
});

h.test('set_reminder without a timeline token returns a clean error', (env) => {
    const t = setup(env);
    env.pebble.timelineTokenOk = false;
    const result = t.exec('set_reminder', {what: 'Müll', time: '2026-10-08T20:00:00+02:00'});
    assert.ok(/timeline is not available/.test(result.error));
    assert.strictEqual(result.user_message, 'Reminders unavailable - no timeline access');
    assert.strictEqual(t.xhrs.length, 0, 'no pin request');
    assert.strictEqual(env.storage.getItem('billy_reminders'), null, 'nothing stored');
});

h.test('set_reminder inserts a timeline pin and keeps the near-future warning', (env) => {
    const t = setup(env);
    const result = t.exec('set_reminder', {what: 'Tee', delay_mins: 20});
    assert.ok(/near future may not appear on time/.test(result.warning), JSON.stringify(result));
    assert.strictEqual(t.xhrs.length, 1);
    assert.strictEqual(t.xhrs[0].method, 'PUT');
    assert.ok(t.xhrs[0].url.indexOf('https://timeline-api.rebble.io/v1/user/pins/') === 0);
    const pin = JSON.parse(t.xhrs[0].sentBody);
    assert.strictEqual(pin.layout.title, 'Tee');
    assert.strictEqual(pin.time, new Date(NOW + 20 * 60000).toISOString());
    assert.strictEqual(t.watch.messages('ACTION_REMINDER_WAS_SET').length, 1);
    const far = t.exec('set_reminder', {what: 'Zahnarzt', time: '2026-10-09T09:00:00+02:00'});
    assert.deepStrictEqual(far, {status: 'ok'});
});

h.test('the timeline token check gives up after a few seconds', (env) => {
    const t = setup(env);
    env.pebble.getTimelineToken = function() {};
    let result;
    h.pkjs('agent/tools').execute(t.session, {id: 'c', name: 'set_reminder', arguments: {what: 'x', delay_mins: 5}}, (r) => {
        result = r;
    });
    assert.strictEqual(result, undefined);
    env.clock.tick(5000);
    assert.ok(result && result.user_message);
});

h.test('deleting an unknown reminder fails once and does not touch the watch', (env) => {
    const t = setup(env);
    let calls = 0;
    h.pkjs('agent/tools').execute(t.session, {id: 'c', name: 'delete_reminder', arguments: {id: 'nope'}}, () => {
        calls++;
    });
    assert.strictEqual(calls, 1);
    assert.strictEqual(t.watch.messages('ACTION_REMINDER_DELETED').length, 0);
});

h.test('get_reminders and delete_reminder round trip', (env) => {
    const t = setup(env);
    t.exec('set_reminder', {what: 'Zahnarzt', time: '2026-10-09T09:00:00+02:00'});
    const list = t.exec('get_reminders', {});
    assert.strictEqual(list.reminders.length, 1);
    const id = list.reminders[0].id;
    assert.deepStrictEqual(t.exec('delete_reminder', {id: id}), {status: 'ok'});
    assert.strictEqual(t.exec('get_reminders', {}).reminders.length, 0);
    assert.strictEqual(t.xhrs[t.xhrs.length - 1].method, 'DELETE');
});

h.test('update_settings changes settings and tells the watch', (env) => {
    const t = setup(env);
    const result = t.exec('update_settings', {unitSystem: 'metric', timerVibrationPattern: 'Mario'});
    assert.deepStrictEqual(result, {status: 'ok'});
    assert.strictEqual(h.pkjs('config').getSetting('UNIT_PREFERENCE'), 'metric');
    assert.strictEqual(t.watch.messages('TIMER_VIBE_PATTERN')[0].TIMER_VIBE_PATTERN, '2');
    assert.ok(/units to metric/.test(t.watch.messages('ACTION_SETTINGS_UPDATED')[0].ACTION_SETTINGS_UPDATED));
});

h.test('argument parse errors and unknown tools come back as tool errors', (env) => {
    const t = setup(env);
    let result;
    h.pkjs('agent/tools').execute(t.session, {id: 'c', name: 'set_timer', arguments: null, argumentsError: 'arguments are not valid JSON'}, (r) => {
        result = r;
    });
    assert.strictEqual(result.status, 'error');
    assert.ok(/Invalid arguments for set_timer/.test(result.error));
    assert.ok(/Unknown tool/.test(t.exec('send_email', {}).error));
});
