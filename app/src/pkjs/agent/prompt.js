/**
 * Copyright 2025 Google LLC
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

var config = require('../config');
var location = require('../location');
var timeFormat = require('./time_format');
var uiTools = require('./ui_tools');

// The system prompt must be byte-identical between requests (as long as the settings don't
// change) so llama-server can reuse its prompt cache. Anything that changes per request, such
// as the time or the location, goes into a context line at the start of the new user message.

var LANGUAGE_NAMES = {
    af_ZA: 'Afrikaans', id_ID: 'Indonesian', ms_MY: 'Malay', cs_CZ: 'Czech', da_DK: 'Danish',
    de_DE: 'German', en_US: 'English', es_ES: 'Spanish', fil_PH: 'Filipino', fr_FR: 'French',
    gl_ES: 'Galician', hr_HR: 'Croatian', is_IS: 'Icelandic', it_IT: 'Italian', sw_TZ: 'Swahili',
    lv_LV: 'Latvian', lt_LT: 'Lithuanian', hu_HU: 'Hungarian', nl_NL: 'Dutch', no_NO: 'Norwegian',
    pl_PL: 'Polish', pt_PT: 'Portuguese', ro_RO: 'Romanian', ru_RU: 'Russian', sk_SK: 'Slovak',
    sl_SI: 'Slovenian', fi_FI: 'Finnish', sv_SE: 'Swedish', tr_TR: 'Turkish', 'zu-ZA': 'Zulu', zu_ZA: 'Zulu'
};

var UNIT_DESCRIPTIONS = {
    metric: 'metric units',
    imperial: 'imperial units',
    uk: 'UK units (miles and mph, otherwise metric)',
    both: 'both metric and imperial units'
};

var MAX_LOCATION_AGE_MS = 30 * 60 * 1000;
var MAX_LOCATION_ACCURACY_METERS = 25000;

exports.CONTEXT_PREFIX = '[Context] ';

function languageInstruction() {
    var code = String(config.getSetting('LANGUAGE_CODE', '') || '');
    if (!code || code === 'automatic') {
        return 'Reply in the language of the user\'s message.';
    }
    var name = LANGUAGE_NAMES[code];
    return 'Always reply in ' + (name ? name + ' (' + code + ')' : 'the language with code ' + code) + '.';
}

function unitInstruction() {
    var units = UNIT_DESCRIPTIONS[String(config.getSetting('UNIT_PREFERENCE', '') || '')];
    return units ? 'Use ' + units + '.' : 'Use the units customary at the user\'s location.';
}

exports.buildSystemPrompt = function() {
    return [
        'You are Benny, a voice assistant on a Pebble smartwatch.',
        'The user dictates. Silently correct obvious speech recognition errors.',
        'Replies are shown on a tiny screen: 2-4 short lines of plain text. No markdown, no asterisks, headings, tables or code. Use "- " for lists.',
        'Use the tools for alarms, timers, reminders, watch settings and weather. Never say that something was set, changed or deleted unless a tool result in this conversation says "status": "ok". If a tool returns an error, tell the user briefly, using its user_message if there is one.',
        'Every user message starts with a ' + exports.CONTEXT_PREFIX.replace(/\s+$/, '') + ' line with the current local time, date, weekday, timezone and location. Use it for all date and time calculations. Do not mention it unless asked.',
        'Tool times are ISO 8601 with the local UTC offset, e.g. 2026-10-08T07:00:00+02:00. "Tomorrow", "tonight" and weekdays are relative to the local date in the context line. A clock time without a day means the next time it occurs.',
        'Timers take duration_seconds as a whole number. Reminders need either time or delay_mins, never both.',
        'To delete an alarm or timer, first call get_alarms or get_timers and use the exact time returned. To delete a reminder, first call get_reminders and use its id.',
        'If the request is ambiguous and a wrong guess would set or delete the wrong thing, call ask_clarifying_question with 2-4 options of at most ' + uiTools.getPickerOptionMaxChars() + ' characters. Do not ask when a sensible default exists.',
        'A user message starting with BILLY_CLARIFICATION_ANSWER contains your earlier question and the user\'s choice: continue the original request.',
        'For weather, call get_weather. The watch card already shows the current temperature and condition, so only add the forecast or practical advice.',
        'You cannot browse the web. If a question needs current information you do not have, say so briefly.',
        languageInstruction(),
        unitInstruction()
    ].join('\n');
};

function locationText(nowMs) {
    if (!config.isLocationEnabled() || !location.isReady()) {
        return 'unknown';
    }
    var pos = location.getPos();
    if (pos.updatedAt && nowMs - pos.updatedAt > MAX_LOCATION_AGE_MS) {
        return 'unknown';
    }
    if (pos.accuracy && pos.accuracy > MAX_LOCATION_ACCURACY_METERS) {
        return 'unknown';
    }
    var text = pos.lat.toFixed(4) + ',' + pos.lon.toFixed(4);
    if (pos.accuracy) {
        text += ' (±' + Math.round(pos.accuracy) + ' m)';
    }
    return text;
}

exports.buildContextLine = function(nowMs) {
    var offset = timeFormat.offsetMinutesAt(nowMs);
    var now = new Date(nowMs);
    var nowText = timeFormat.formatLocalDate(nowMs) + 'T' + timeFormat.pad2(now.getHours()) + ':' +
        timeFormat.pad2(now.getMinutes()) + timeFormat.formatOffset(offset);
    var tomorrowMs = timeFormat.addLocalDays(new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12).getTime(), 1);
    var tomorrowOffset = timeFormat.offsetMinutesAt(tomorrowMs);
    var tomorrowText = timeFormat.formatLocalDate(tomorrowMs) + ' ' + timeFormat.weekdayName(tomorrowMs);
    if (tomorrowOffset !== offset) {
        tomorrowText += ' (UTC' + timeFormat.formatOffset(tomorrowOffset) + ')';
    }
    var zone = timeFormat.timeZoneName();
    return exports.CONTEXT_PREFIX +
        'now=' + nowText + ' ' + timeFormat.weekdayName(nowMs) +
        '; tomorrow=' + tomorrowText +
        '; timezone=' + (zone ? zone + ' ' : '') + 'UTC' + timeFormat.formatOffset(offset) +
        '; location=' + locationText(nowMs);
};

exports.buildUserMessage = function(prompt, nowMs) {
    return exports.buildContextLine(nowMs) + '\n' + prompt;
};
