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

// Local-time formatting helpers. Everything uses the phone's timezone rules via Date.

var WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
exports.WEEKDAYS = WEEKDAYS;

function pad2(value) {
    return (value < 10 ? '0' : '') + value;
}
exports.pad2 = pad2;

// Minutes east of UTC at the given instant, e.g. +120 for CEST.
exports.offsetMinutesAt = function(ms) {
    return -new Date(ms).getTimezoneOffset();
};

exports.formatOffset = function(offsetMinutes) {
    var sign = offsetMinutes < 0 ? '-' : '+';
    var abs = Math.abs(offsetMinutes);
    return sign + pad2(Math.floor(abs / 60)) + ':' + pad2(abs % 60);
};

exports.formatLocalDate = function(ms) {
    var d = new Date(ms);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
};

exports.formatLocalClock = function(ms) {
    var d = new Date(ms);
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
};

// ISO 8601 with the local offset that applies at that instant, e.g. 2026-10-08T07:00:00+02:00.
exports.formatLocalIso = function(ms) {
    var d = new Date(ms);
    return exports.formatLocalDate(ms) + 'T' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' +
        pad2(d.getSeconds()) + exports.formatOffset(exports.offsetMinutesAt(ms));
};

exports.weekdayName = function(ms) {
    return WEEKDAYS[new Date(ms).getDay()];
};

exports.timeZoneName = function() {
    try {
        if (typeof Intl !== 'undefined' && Intl.DateTimeFormat) {
            return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
        }
    } catch (e) {
        // Old runtimes may not have Intl.
    }
    return '';
};

// Same local wall-clock time on the next calendar day (DST-safe).
exports.addLocalDays = function(ms, days) {
    var d = new Date(ms);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days, d.getHours(), d.getMinutes(), d.getSeconds()).getTime();
};
