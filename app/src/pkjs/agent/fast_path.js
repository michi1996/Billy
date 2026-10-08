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

// Handles simple, unambiguous timer and alarm commands without asking the model. The whole
// utterance has to match; anything else (names, weekdays, "morgen", "um 7" without "Uhr",
// combinations) goes to the LLM. Execution uses the same validated tool layer as the model.

var config = require('../config');
var clock = require('./clock');
var timeFormat = require('./time_format');
var tools = require('./tools');

var NUMBER_WORDS = {
    // German (after umlaut folding: fuenf, zwoelf, dreissig; dictation sometimes drops them)
    ein: 1, eins: 1, eine: 1, einen: 1, einer: 1, zwei: 2, drei: 3, vier: 4, fuenf: 5, funf: 5,
    sechs: 6, sieben: 7, acht: 8, neun: 9, zehn: 10, elf: 11, zwoelf: 12, zwolf: 12, dreizehn: 13,
    vierzehn: 14, fuenfzehn: 15, funfzehn: 15, sechzehn: 16, siebzehn: 17, achtzehn: 18,
    neunzehn: 19, zwanzig: 20, dreissig: 30, fuenfundvierzig: 45, funfundvierzig: 45, sechzig: 60,
    // English
    a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
    ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
    seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, 'forty-five': 45,
    'forty five': 45, fortyfive: 45, sixty: 60
};

var DE_NUMBER = '\\d{1,4}|ein|eins|eine|einen|einer|zwei|drei|vier|fuenf|funf|sechs|sieben|acht|neun|zehn|elf|zwoelf|zwolf|dreizehn|vierzehn|fuenfzehn|funfzehn|sechzehn|siebzehn|achtzehn|neunzehn|zwanzig|dreissig|fuenfundvierzig|funfundvierzig|sechzig';
var EN_NUMBER = '\\d{1,4}|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty-five|forty five|fortyfive|sixty';

var DE_UNIT = 'sekunden|sekunde|sek|minuten|minute|min|stunden|stunde|std';
var EN_UNIT = 'seconds|second|secs|sec|minutes|minute|mins|min|hours|hour|hrs|hr';

var UNIT_SECONDS = {
    sekunden: 1, sekunde: 1, sek: 1, minuten: 60, minute: 60, min: 60, stunden: 3600, stunde: 3600, std: 3600,
    seconds: 1, second: 1, secs: 1, sec: 1, minutes: 60, mins: 60, hours: 3600, hour: 3600, hrs: 3600, hr: 3600
};

var DE_LEAD = '(?:bitte )?(?:(?:stell|stelle|setz|setze|mach|mache|starte|start|erstelle|leg|lege)(?: mir)?(?: bitte)?(?: mal)? )?(?:einen |ein |nen |den )?';
var DE_TAIL = '(?: bitte)?(?: (?:an|ein|stellen|setzen|starten|machen))?(?: bitte)?';
var EN_LEAD = '(?:please )?(?:(?:set|start|make|create|put on)(?: me)? )?(?:a |an )?';
var EN_TAIL = '(?: please)?(?: on)?(?: please)?';

var EN_ALARM_LEAD = '(?:please )?(?:(?:(?:set|make|create|add|put on)(?: me)?(?: an| a| the| my)? )?alarm (?:for|at)|wake me(?: up)? at)';
var EN_ALARM_TAIL = '(?: please)?';

var DE_HALF_HOUR = '(?:eine )?halbe stunde';
var EN_HALF_HOUR = 'half an hour|half hour|a half hour';

var PATTERNS = [
    // "Stell einen Timer auf fünf Minuten", "Timer 10 Minuten", "Timer für eine halbe Stunde"
    {lang: 'de', kind: 'timer', regex: new RegExp('^' + DE_LEAD + 'timer (?:(?:fuer|auf|von|mit|ueber) )?(?:(' + DE_NUMBER + ') (' + DE_UNIT + ')|(' + DE_HALF_HOUR + '))' + DE_TAIL + '$')},
    // "10 Minuten Timer", "Zehn-Minuten-Timer"
    {lang: 'de', kind: 'timer', regex: new RegExp('^' + DE_LEAD + '(' + DE_NUMBER + ')[ -](' + DE_UNIT + ')[ -]?timer' + DE_TAIL + '$')},
    // "Set a timer for 5 minutes", "timer for half an hour"
    {lang: 'en', kind: 'timer', regex: new RegExp('^' + EN_LEAD + 'timer (?:(?:for|of) )?(?:(' + EN_NUMBER + ') (' + EN_UNIT + ')|(' + EN_HALF_HOUR + '))' + EN_TAIL + '$')},
    // "Start a 10-minute timer", "5 minute timer"
    {lang: 'en', kind: 'timer', regex: new RegExp('^' + EN_LEAD + '(' + EN_NUMBER + ')[ -](' + EN_UNIT + ')[ -]?timer' + EN_TAIL + '$')},
    // "Wecker um 6:45", "Stell einen Wecker für 7 Uhr", "Wecker um 7 Uhr 30", "Weck mich um 7.30 Uhr"
    {lang: 'de', kind: 'alarm', regex: new RegExp('^(?:' + DE_LEAD + 'wecker (?:um|fuer|auf)|(?:bitte )?wecke? mich(?: bitte)? um) ' +
        '(?:(\\d{1,2})[:.](\\d{2})(?: uhr)?|(\\d{1,2}) uhr(?: (\\d{1,2}))?)' + DE_TAIL + '$')},
    // "Set an alarm for 6:45 am", "Wake me up at 7 pm", "Alarm at 18:30". Times like "7:30"
    // without am/pm are ambiguous and go to the model.
    {lang: 'en', kind: 'alarm_en', regex: new RegExp('^' + EN_ALARM_LEAD + ' ' +
        '(?:(\\d{1,2})(?:[:.](\\d{2}))? ?(a\\.?m|p\\.?m)\\.?|(\\d{1,2})[:.](\\d{2}))' + EN_ALARM_TAIL + '$')}
];

// Words that only occur in one of the two languages. "timer", "min", "minute" and digits are shared.
var DE_ONLY = /\b(?:minuten|sekunden|sekunde|sek|stunden|stunde|std|fuer|auf|von|mit|ueber|stell|stelle|setz|setze|mach|mache|starte|erstelle|leg|lege|mir|bitte|mal|einen?|einer|eins|nen|den|halbe|stellen|setzen|starten|machen|zwei|drei|vier|fuenf|funf|sechs|sieben|acht|neun|zehn|elf|zwoelf|zwolf|dreizehn|vierzehn|fuenfzehn|funfzehn|sechzehn|siebzehn|achtzehn|neunzehn|zwanzig|dreissig|fuenfundvierzig|funfundvierzig|sechzig)\b/g;
var EN_ONLY = /\b(?:seconds|second|secs|sec|minutes|mins|hours|hour|hrs|hr|for|of|set|start|make|create|put|please|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|sixty|half)\b/g;

function countMatches(text, regex) {
    var found = text.match(regex);
    return found ? found.length : 0;
}

function timerLanguage(text, amount, unitWord) {
    var de = countMatches(text, DE_ONLY);
    var en = countMatches(text, EN_ONLY);
    if (de !== en) {
        return de > en ? 'de' : 'en';
    }
    // Only shared words: "5 minute timer" is English, "Timer 1 Minute" German.
    return unitWord === 'minute' && amount !== 1 ? 'en' : 'de';
}

function normalize(prompt) {
    return String(prompt || '')
        .toLowerCase()
        .replace(/\u00e4/g, 'ae').replace(/\u00f6/g, 'oe').replace(/\u00fc/g, 'ue').replace(/\u00df/g, 'ss')
        .replace(/[\u2010-\u2015]/g, '-')
        .replace(/[!?,;"']+/g, ' ')
        .replace(/\.+\s*$/, '')
        .replace(/\s+/g, ' ')
        .replace(/^\s+|\s+$/g, '');
}

function parseNumber(text) {
    if (/^\d+$/.test(text)) {
        return parseInt(text, 10);
    }
    return NUMBER_WORDS.hasOwnProperty(text) ? NUMBER_WORDS[text] : null;
}

function matchTimer(pattern, m, text) {
    if (m[3]) {
        return {kind: 'timer', lang: pattern.lang, seconds: 1800, amount: 30, unit: 60};
    }
    var amount = parseNumber(m[1]);
    var unit = UNIT_SECONDS[m[2]];
    if (!amount || !unit) {
        return null;
    }
    var seconds = amount * unit;
    if (seconds < 1 || seconds > 86400 * 7) {
        return null;
    }
    return {kind: 'timer', lang: timerLanguage(text, amount, m[2]), seconds: seconds, amount: amount, unit: unit};
}

// The next time the clock shows hour:minute (today, or tomorrow if that has passed).
function alarmAt(hour, minute, nowMs, lang, use12h) {
    if (isNaN(hour) || isNaN(minute) || hour > 23 || minute > 59) {
        return null;
    }
    var now = new Date(nowMs);
    var target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0).getTime();
    var tomorrow = false;
    if (target <= nowMs) {
        target = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, hour, minute, 0).getTime();
        tomorrow = true;
    }
    return {kind: 'alarm', lang: lang, ms: target, tomorrow: tomorrow, use12h: use12h};
}

function matchGermanAlarm(pattern, m, nowMs) {
    var hour = parseInt(m[1] !== undefined ? m[1] : m[3], 10);
    var minute = m[2] !== undefined ? parseInt(m[2], 10) : (m[4] !== undefined ? parseInt(m[4], 10) : 0);
    return alarmAt(hour, minute, nowMs, pattern.lang, false);
}

function matchEnglishAlarm(pattern, m, nowMs) {
    var hour;
    var minute;
    if (m[3]) {
        hour = parseInt(m[1], 10);
        minute = m[2] !== undefined ? parseInt(m[2], 10) : 0;
        if (hour < 1 || hour > 12) {
            return null;
        }
        hour = hour % 12 + (m[3].charAt(0) === 'p' ? 12 : 0);
        return alarmAt(hour, minute, nowMs, pattern.lang, true);
    }
    // Without am/pm only unambiguous 24-hour times: 0:xx, 13:00-23:59 or a leading zero (07:30).
    hour = parseInt(m[4], 10);
    minute = parseInt(m[5], 10);
    if (!(hour === 0 || hour >= 13 || (m[4].length === 2 && m[4].charAt(0) === '0'))) {
        return null;
    }
    return alarmAt(hour, minute, nowMs, pattern.lang, false);
}

// Returns null or a description of the command, e.g. {kind: 'timer', seconds: 300, lang: 'de'}.
exports.match = function(prompt, nowMs) {
    var text = normalize(prompt);
    if (!text || text.length > 80) {
        return null;
    }
    for (var i = 0; i < PATTERNS.length; i++) {
        var m = PATTERNS[i].regex.exec(text);
        if (!m) {
            continue;
        }
        if (PATTERNS[i].kind === 'timer') {
            return matchTimer(PATTERNS[i], m, text);
        }
        if (PATTERNS[i].kind === 'alarm_en') {
            return matchEnglishAlarm(PATTERNS[i], m, nowMs);
        }
        return matchGermanAlarm(PATTERNS[i], m, nowMs);
    }
    return null;
};

function replyLanguage(matchLang) {
    var code = String(config.getSetting('LANGUAGE_CODE', '') || '').toLowerCase();
    if (code.indexOf('de') === 0) {
        return 'de';
    }
    if (code.indexOf('en') === 0) {
        return 'en';
    }
    return matchLang;
}

function durationText(command, lang) {
    var amount = command.seconds % command.unit === 0 ? command.seconds / command.unit : command.seconds;
    var unit = command.seconds % command.unit === 0 ? command.unit : 1;
    var names = lang === 'de' ?
        {1: ['Sekunde', 'Sekunden'], 60: ['Minute', 'Minuten'], 3600: ['Stunde', 'Stunden']} :
        {1: ['second', 'seconds'], 60: ['minute', 'minutes'], 3600: ['hour', 'hours']};
    return amount + ' ' + names[unit][amount === 1 ? 0 : 1];
}

function twelveHourClock(ms) {
    var d = new Date(ms);
    var hour = d.getHours() % 12 || 12;
    return hour + ':' + timeFormat.pad2(d.getMinutes()) + (d.getHours() < 12 ? ' AM' : ' PM');
}

exports.confirmation = function(command, lang) {
    if (command.kind === 'timer') {
        return lang === 'de' ?
            'Timer f\u00fcr ' + durationText(command, 'de') + ' gestellt.' :
            'Timer set for ' + durationText(command, 'en') + '.';
    }
    if (lang === 'de') {
        return 'Wecker f\u00fcr ' + (command.tomorrow ? 'morgen' : 'heute') + ' ' + timeFormat.formatLocalClock(command.ms) + ' gestellt.';
    }
    var clockText = command.use12h ? twelveHourClock(command.ms) : timeFormat.formatLocalClock(command.ms);
    return 'Alarm set for ' + (command.tomorrow ? 'tomorrow' : 'today') + ' at ' + clockText + '.';
};

function failureText(result, lang) {
    if (result && result.user_message) {
        return result.user_message;
    }
    return 'That did not work.';
}

// Returns true if the prompt was handled here. `done(text, isError)` receives the reply.
exports.tryHandle = function(session, done) {
    var command = exports.match(session.prompt, clock.now());
    if (!command) {
        return false;
    }
    var lang = replyLanguage(command.lang);
    console.log('Fast path: ' + command.kind);
    var call = command.kind === 'timer' ?
        {id: 'fast_path', name: 'set_timer', arguments: {duration_seconds: command.seconds}, argumentsError: null} :
        {id: 'fast_path', name: 'set_alarm', arguments: {time: timeFormat.formatLocalIso(command.ms)}, argumentsError: null};
    tools.execute(session, call, function(result) {
        if (result && result.status === 'ok') {
            done(exports.confirmation(command, lang), false);
        } else {
            console.log('Fast path tool failed: ' + (result && result.error));
            done(failureText(result, lang), true);
        }
    });
    return true;
};
