'use strict';

const assert = require('node:assert');
const h = require('./harness');

// Wednesday 2026-10-07 21:46:00 CEST.
const NOW = Date.UTC(2026, 9, 7, 19, 46, 0);
// Saturday 2026-10-24 20:00 CEST, the evening before the switch to CET.
const BEFORE_FALL_BACK = Date.UTC(2026, 9, 24, 18, 0, 0);
// Saturday 2026-03-28 20:00 CET, the evening before the switch to CEST.
const BEFORE_SPRING_FORWARD = Date.UTC(2026, 2, 28, 19, 0, 0);

function v() {
    return h.pkjs('agent/validation');
}

function ok(name, args, now) {
    const result = v().validate(name, args, now === undefined ? NOW : now);
    assert.strictEqual(result.ok, true, 'expected ok, got: ' + result.error);
    return result.args;
}

function err(name, args, now, pattern) {
    const result = v().validate(name, args, now === undefined ? NOW : now);
    assert.strictEqual(result.ok, false, 'expected an error for ' + JSON.stringify(args));
    if (pattern) {
        assert.ok(pattern.test(result.error), result.error);
    }
    return result.error;
}

h.test('ISO time with offset is kept and normalised', () => {
    assert.deepStrictEqual(ok('set_alarm', {time: '2026-10-08T07:00:00+02:00'}), {time: '2026-10-08T07:00:00+02:00', name: null});
    assert.strictEqual(ok('set_alarm', {time: '2026-10-08T05:00:00Z'}).time, '2026-10-08T07:00:00+02:00');
    assert.strictEqual(ok('set_alarm', {time: '2026-10-08 07:00+0200'}).time, '2026-10-08T07:00:00+02:00');
    assert.strictEqual(ok('set_alarm', {time: '2026-10-08T07:00:00.000+02:00'}).time, '2026-10-08T07:00:00+02:00');
});

h.test('ISO time without offset gets the local offset of that date', () => {
    assert.strictEqual(ok('set_alarm', {time: '2026-10-08T07:00'}).time, '2026-10-08T07:00:00+02:00');
    assert.strictEqual(ok('set_alarm', {time: '2026-11-02T07:00:00'}).time, '2026-11-02T07:00:00+01:00');
});

h.test('times that are not ISO 8601 are rejected', () => {
    err('set_alarm', {time: 'tomorrow 7am'}, NOW, /not ISO 8601/);
    err('set_alarm', {time: '07:00'}, NOW, /not ISO 8601/);
    err('set_alarm', {time: '2026-02-30T07:00:00+01:00'}, NOW, /not a valid date/);
    err('set_alarm', {time: '2026-10-08T25:00:00+02:00'}, NOW, /not a valid date/);
    err('set_alarm', {time: 1791000000}, NOW, /ISO 8601 string/);
    err('set_alarm', {}, NOW, /time is required/);
});

h.test('time must be in the future, with a small tolerance', () => {
    ok('set_alarm', {time: '2026-10-07T21:45:30+02:00'});
    err('set_alarm', {time: '2026-10-07T21:40:00+02:00'}, NOW, /in the past; it is now 2026-10-07T21:46:00\+02:00/);
    err('set_reminder', {what: 'x', time: '2026-10-07T08:00:00+02:00'}, NOW, /in the past/);
});

h.test('time may be at most one year away', () => {
    ok('set_reminder', {what: 'Steuern', time: '2027-10-07T21:46:00+02:00'});
    err('set_reminder', {what: 'Steuern', time: '2027-10-08T09:00:00+02:00'}, NOW, /more than one year/);
    err('set_alarm', {time: '2030-01-01T07:00:00+01:00'}, NOW, /more than one year/);
});

h.test('end of DST: a copied current offset is corrected to the wall-clock time', () => {
    // The model copies +02:00 from the context line, but on 25 October Zurich is at +01:00.
    const args = ok('set_alarm', {time: '2026-10-25T07:00:00+02:00'}, BEFORE_FALL_BACK);
    assert.strictEqual(args.time, '2026-10-25T07:00:00+01:00');
    // A correct offset stays as it is.
    assert.strictEqual(ok('set_alarm', {time: '2026-10-25T07:00:00+01:00'}, BEFORE_FALL_BACK).time, '2026-10-25T07:00:00+01:00');
    // An explicit other timezone is respected.
    assert.strictEqual(ok('set_alarm', {time: '2026-10-25T07:00:00-04:00'}, BEFORE_FALL_BACK).time, '2026-10-25T12:00:00+01:00');
});

h.test('start of DST: a copied +01:00 becomes +02:00 for the wall-clock time', () => {
    assert.strictEqual(ok('set_alarm', {time: '2026-03-29T07:00:00+01:00'}, BEFORE_SPRING_FORWARD).time, '2026-03-29T07:00:00+02:00');
    // 02:30 does not exist that night; JavaScript moves it to 03:30 local time.
    assert.strictEqual(ok('set_alarm', {time: '2026-03-29T02:30:00'}, BEFORE_SPRING_FORWARD).time, '2026-03-29T03:30:00+02:00');
});

h.test('midnight: 00:00 tomorrow is valid, 00:00 today is in the past', () => {
    const lateEvening = Date.UTC(2026, 9, 7, 21, 59, 30); // 23:59:30 local
    assert.strictEqual(ok('set_alarm', {time: '2026-10-08T00:00:00+02:00'}, lateEvening).time, '2026-10-08T00:00:00+02:00');
    err('set_alarm', {time: '2026-10-07T00:00:00+02:00'}, lateEvening, /in the past/);
});

h.test('delete_alarm and delete_timer only need a parseable time', () => {
    assert.strictEqual(ok('delete_alarm', {time: '2026-10-07T05:00:00.000Z'}).time, '2026-10-07T07:00:00+02:00');
    assert.strictEqual(ok('delete_timer', {time: '2026-10-07T19:51:00.000Z'}).time, '2026-10-07T21:51:00+02:00');
    err('delete_timer', {}, NOW, /get_ tool/);
});

h.test('timer duration must be a whole number between 1 and 7 days', () => {
    assert.strictEqual(ok('set_timer', {duration_seconds: 300}).duration_seconds, 300);
    assert.strictEqual(ok('set_timer', {duration_seconds: '90'}).duration_seconds, 90);
    assert.strictEqual(ok('set_timer', {duration_seconds: 604800}).duration_seconds, 604800);
    assert.strictEqual(ok('set_timer', {duration_minutes: 5}).duration_seconds, 300);
    assert.strictEqual(ok('set_timer', {duration_hours: 1, duration_minutes: 30}).duration_seconds, 5400);
    err('set_timer', {duration_seconds: 300.5}, NOW, /whole number/);
    err('set_timer', {duration_seconds: '5 min'}, NOW, /whole number/);
    err('set_timer', {duration_seconds: 0}, NOW, /between 1 and 604800/);
    err('set_timer', {duration_seconds: -5}, NOW, /between 1 and 604800/);
    err('set_timer', {duration_seconds: 604801}, NOW, /between 1 and 604800/);
    err('set_timer', {}, NOW, /duration_seconds is required/);
});

h.test('names are trimmed to what the watch can store (31 bytes)', () => {
    assert.strictEqual(ok('set_timer', {duration_seconds: 60, name: '  Pizza  '}).name, 'Pizza');
    assert.strictEqual(ok('set_timer', {duration_seconds: 60, name: ''}).name, null);
    const long = ok('set_timer', {duration_seconds: 60, name: 'Größere Übungseinheit für Gemüsesuppe'}).name;
    assert.ok(Buffer.byteLength(long, 'utf8') <= 31, long);
    assert.ok(long.indexOf('Größere') === 0);
});

h.test('reminders need exactly one of time or delay_mins and some text', () => {
    assert.deepStrictEqual(ok('set_reminder', {what: ' Müll rausbringen ', time: '2026-10-08T20:00:00+02:00'}),
        {what: 'Müll rausbringen', time: '2026-10-08T20:00:00+02:00'});
    assert.deepStrictEqual(ok('set_reminder', {what: 'Tee', delay_mins: 20}), {what: 'Tee', time: '2026-10-07T22:06:00+02:00'});
    assert.strictEqual(ok('set_reminder', {what: 'Tee', delay_mins: 20, time: ''}).time, '2026-10-07T22:06:00+02:00');
    err('set_reminder', {what: 'Tee', delay_mins: 20, time: '2026-10-08T20:00:00+02:00'}, NOW, /exactly one/);
    err('set_reminder', {what: 'Tee'}, NOW, /exactly one/);
    err('set_reminder', {what: '   ', delay_mins: 5}, NOW, /may not be empty/);
    err('set_reminder', {delay_mins: 5}, NOW, /may not be empty/);
    err('set_reminder', {what: 'Tee', delay_mins: 0}, NOW, /between 1/);
    err('set_reminder', {what: 'Tee', delay_mins: 2.5}, NOW, /whole number/);
});

h.test('delete_reminder needs an id, update_settings a known setting', () => {
    assert.deepStrictEqual(ok('delete_reminder', {id: 'benny-reminder-1'}), {id: 'benny-reminder-1'});
    err('delete_reminder', {}, NOW, /get_reminders/);
    assert.deepStrictEqual(ok('update_settings', {unitSystem: 'metric', bogus: 1}), {unitSystem: 'metric'});
    assert.deepStrictEqual(ok('update_settings', {confirmPrompts: false}), {confirmPrompts: false});
    err('update_settings', {bogus: 1}, NOW, /no supported setting/);
    err('frobnicate', {}, NOW, /unknown tool/);
});
