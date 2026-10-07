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

function getLocalTimeSentence() {
    var now = new Date();
    var timezone = 'unknown';
    try {
        if (Intl && Intl.DateTimeFormat) {
            timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || timezone;
        }
    } catch (e) {
        timezone = 'unknown';
    }
    var offsetMinutes = -now.getTimezoneOffset();
    var sign = offsetMinutes >= 0 ? '+' : '-';
    var abs = Math.abs(offsetMinutes);
    var offset = sign + ('0' + Math.floor(abs / 60)).slice(-2) + ':' + ('0' + (abs % 60)).slice(-2);
    return 'The phone/watch local time is ' + now.toString() + '. The local IANA timezone is ' + timezone + ' and the current UTC offset is ' + offset + '. For alarms, timers, and reminders, interpret relative times like tomorrow using this local watch timezone unless the user explicitly names another timezone. ';
}

function getPickerOptionMaxChars() {
    var platform = '';
    try {
        platform = Pebble && Pebble.platform ? Pebble.platform : '';
    } catch (e) {
        platform = '';
    }
    if (platform === 'emery') {
        return 28;
    }
    if (platform === 'basalt') {
        return 20;
    }
    return 18;
}

exports.buildSystemInstruction = function() {
    var language = config.getSetting('LANGUAGE_CODE', 'automatic');
    var units = config.getSetting('UNIT_PREFERENCE', '');
    var pickerOptionMax = getPickerOptionMaxChars();
    var parts = [
        'You are Benny, an assistant running from a Pebble smartwatch.',
        'The user prompt is transcribed from watch voice input, so silently correct obvious speech recognition errors.',
        'Only watch-facing final replies are displayed on a very small screen. Be concise but useful for those replies: usually 2-4 short watch lines. Avoid vague one-line answers. Use Pebble-safe formatting only for watch-facing final text: short lines, line breaks, and "- " bullets. Do not use markdown asterisks, code fences, tables, headings, citations, or other markdown in watch-facing final text unless asked.',
        'You have no web search. If a question needs current information you do not have, say so briefly.',
        'Never claim to set an alarm, timer, reminder, or setting unless a local tool actually completed it.',
        'When the request is ambiguous and a wrong guess could create, change, or delete something incorrectly, call ask_clarifying_question with 2-4 short options instead of guessing. Picker option labels must be ' + pickerOptionMax + ' characters or fewer. Ask only one question at a time. Prefer clarification for a missing reminder date or which alarm, timer, or reminder the user means. Do not ask if a safe default is obvious.',
        'For weather, temperature, wind, umbrella, or forecast requests, call get_weather when it is available. The weather card already shows current temperature, feels-like, icon, and condition; put forecast or practical guidance in the short text after it instead of repeating the same current numbers.',
        'For watch actions, be resilient to dictation errors. If a phrase sounds like a request to set, create, add, make, start, get, or schedule a reminder, alarm, or timer, prefer the available watch tool.',
        'If the user says "get a reminder" followed by a task or time, interpret it as "set a reminder" unless they clearly ask to list existing reminders.',
        getLocalTimeSentence()
    ];
    var locationContext = location.getPromptContextSentence();
    if (locationContext) {
        parts.push(locationContext);
    }
    if (language && language !== 'automatic') {
        parts.push('Respond using language code ' + language + '.');
    } else {
        parts.push('Respond in the language the user is using unless they ask otherwise.');
    }
    if (units) {
        parts.push('Use the user unit preference: ' + units + '.');
    }
    return parts.join(' ');
}
