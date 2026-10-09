/**
 * Copyright 2026 Achi
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// Validates and normalises tool arguments before anything reaches the watch. A failure is
// returned to the model as a tool result so it can correct itself.

var timeFormat = require('./time_format');

var PAST_TOLERANCE_MS = 60 * 1000;
var MAX_TIMER_SECONDS = 86400 * 7;
var MAX_REMINDER_DELAY_MINS = 366 * 24 * 60;
// Matches ALARM_NAME_SIZE - 1 in src/c/alarms/manager.c (bytes, not characters).
var MAX_NAME_BYTES = 31;

exports.MAX_TIMER_SECONDS = MAX_TIMER_SECONDS;

var ISO_REGEX = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:[.,]\d+)?)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?$/i;

function fail(message) {
    return {ok: false, error: message};
}

function ok(args) {
    return {ok: true, args: args};
}

function isBlank(value) {
    return value === undefined || value === null || (typeof value === 'string' && value.replace(/\s+/g, '') === '');
}

function parseOffsetMinutes(text) {
    if (/^z$/i.test(text)) {
        return 0;
    }
    var match = /^([+-])(\d{2}):?(\d{2})?$/.exec(text);
    var minutes = parseInt(match[2], 10) * 60 + (match[3] ? parseInt(match[3], 10) : 0);
    return match[1] === '-' ? -minutes : minutes;
}

// Parses an ISO 8601 date-time. Without an offset the local timezone is used.
// If the model copied the *current* local offset but a different offset applies on the target
// date (a daylight saving switch in between), the wall-clock time is what the user meant.
exports.parseTime = function(value, nowMs) {
    if (typeof value !== 'string') {
        return {error: 'time must be an ISO 8601 string such as 2026-10-08T07:00:00+02:00'};
    }
    var match = ISO_REGEX.exec(value.replace(/^\s+|\s+$/g, ''));
    if (!match) {
        return {error: 'time "' + value + '" is not ISO 8601 (expected e.g. 2026-10-08T07:00:00+02:00)'};
    }
    var year = parseInt(match[1], 10);
    var month = parseInt(match[2], 10);
    var day = parseInt(match[3], 10);
    var hour = parseInt(match[4], 10);
    var minute = parseInt(match[5], 10);
    var second = match[6] ? parseInt(match[6], 10) : 0;
    var check = new Date(Date.UTC(year, month - 1, day));
    if (month < 1 || month > 12 || check.getUTCDate() !== day || check.getUTCMonth() !== month - 1 ||
            hour > 23 || minute > 59 || second > 59) {
        return {error: 'time "' + value + '" is not a valid date and time'};
    }
    var localMs = new Date(year, month - 1, day, hour, minute, second).getTime();
    if (!match[7]) {
        return {ms: localMs, offsetGiven: false};
    }
    var offset = parseOffsetMinutes(match[7]);
    var ms = Date.UTC(year, month - 1, day, hour, minute, second) - offset * 60000;
    var currentOffset = timeFormat.offsetMinutesAt(nowMs);
    if (offset === currentOffset && timeFormat.offsetMinutesAt(localMs) !== offset) {
        return {ms: localMs, offsetGiven: true, dstAdjusted: true};
    }
    return {ms: ms, offsetGiven: true};
};

function futureTime(value, nowMs, label) {
    var parsed = exports.parseTime(value, nowMs);
    if (parsed.error) {
        return parsed;
    }
    if (parsed.ms < nowMs - PAST_TOLERANCE_MS) {
        return {error: label + ' ' + timeFormat.formatLocalIso(parsed.ms) + ' is in the past; it is now ' +
            timeFormat.formatLocalIso(nowMs) + '. Use a future time.'};
    }
    var limit = new Date(nowMs);
    limit.setFullYear(limit.getFullYear() + 1);
    if (parsed.ms > limit.getTime() + PAST_TOLERANCE_MS) {
        return {error: label + ' ' + timeFormat.formatLocalIso(parsed.ms) + ' is more than one year away.'};
    }
    return parsed;
}

function parseWholeNumber(value, label) {
    if (typeof value === 'string' && /^\s*\d+\s*$/.test(value)) {
        value = parseInt(value, 10);
    }
    if (typeof value !== 'number' || !isFinite(value) || Math.floor(value) !== value) {
        return {error: label + ' must be a whole number'};
    }
    return {value: value};
}

function utf8Length(text) {
    return unescape(encodeURIComponent(text)).length;
}

function cleanName(value) {
    if (isBlank(value)) {
        return null;
    }
    var name = String(value).replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
    while (utf8Length(name) > MAX_NAME_BYTES) {
        name = name.substring(0, name.length - 1);
    }
    return name.replace(/\s+$/, '') || null;
}

function validateSetAlarm(args, nowMs) {
    if (isBlank(args.time)) {
        return fail('time is required');
    }
    var parsed = futureTime(args.time, nowMs, 'alarm time');
    if (parsed.error) {
        return fail(parsed.error);
    }
    return ok({time: timeFormat.formatLocalIso(parsed.ms), name: cleanName(args.name)});
}

function validateDeleteByTime(args, nowMs) {
    if (isBlank(args.time)) {
        return fail('time is required; call the matching get_ tool first and use the exact time it returned');
    }
    var parsed = exports.parseTime(args.time, nowMs);
    if (parsed.error) {
        return fail(parsed.error);
    }
    return ok({time: timeFormat.formatLocalIso(parsed.ms)});
}

function validateSetTimer(args) {
    var total = 0;
    var parts = [['duration_seconds', 1], ['duration_minutes', 60], ['duration_hours', 3600]];
    var seen = false;
    for (var i = 0; i < parts.length; i++) {
        if (isBlank(args[parts[i][0]])) {
            continue;
        }
        var number = parseWholeNumber(args[parts[i][0]], parts[i][0]);
        if (number.error) {
            return fail(number.error);
        }
        seen = true;
        total += number.value * parts[i][1];
    }
    if (!seen) {
        return fail('duration_seconds is required');
    }
    if (total < 1 || total > MAX_TIMER_SECONDS) {
        return fail('duration_seconds must be between 1 and ' + MAX_TIMER_SECONDS + ' (7 days)');
    }
    return ok({duration_seconds: total, name: cleanName(args.name)});
}

function validateSetReminder(args, nowMs) {
    var what = isBlank(args.what) ? '' : String(args.what).replace(/^\s+|\s+$/g, '');
    if (!what) {
        return fail('what must describe the reminder and may not be empty');
    }
    var hasTime = !isBlank(args.time);
    var hasDelay = !isBlank(args.delay_mins);
    if (hasTime === hasDelay) {
        return fail('provide exactly one of time or delay_mins');
    }
    var ms;
    if (hasDelay) {
        var delay = parseWholeNumber(args.delay_mins, 'delay_mins');
        if (delay.error) {
            return fail(delay.error);
        }
        if (delay.value < 1 || delay.value > MAX_REMINDER_DELAY_MINS) {
            return fail('delay_mins must be between 1 and ' + MAX_REMINDER_DELAY_MINS);
        }
        ms = nowMs + delay.value * 60000;
    } else {
        var parsed = futureTime(args.time, nowMs, 'reminder time');
        if (parsed.error) {
            return fail(parsed.error);
        }
        ms = parsed.ms;
    }
    return ok({what: what, time: timeFormat.formatLocalIso(ms)});
}

function validateDeleteReminder(args) {
    if (isBlank(args.id)) {
        return fail('id is required; call get_reminders first to find it');
    }
    return ok({id: String(args.id)});
}

var SETTING_KEYS = ['unitSystem', 'responseLanguage', 'alarmVibrationPattern', 'timerVibrationPattern', 'quickLaunchBehaviour', 'confirmPrompts'];

function validateUpdateSettings(args) {
    var result = {};
    var count = 0;
    SETTING_KEYS.forEach(function(key) {
        if (!isBlank(args[key])) {
            result[key] = args[key];
            count++;
        }
    });
    if (count === 0) {
        return fail('no supported setting given; use one of ' + SETTING_KEYS.join(', '));
    }
    return ok(result);
}

function noArguments() {
    return ok({});
}

var validators = {
    set_alarm: validateSetAlarm,
    get_alarms: noArguments,
    delete_alarm: validateDeleteByTime,
    set_timer: validateSetTimer,
    get_timers: noArguments,
    delete_timer: validateDeleteByTime,
    set_reminder: validateSetReminder,
    get_reminders: noArguments,
    delete_reminder: validateDeleteReminder,
    update_settings: validateUpdateSettings
};

exports.hasValidator = function(name) {
    return validators.hasOwnProperty(name);
};

exports.validate = function(name, args, nowMs) {
    if (!validators.hasOwnProperty(name)) {
        return fail('unknown tool ' + name);
    }
    return validators[name](args || {}, nowMs);
};
