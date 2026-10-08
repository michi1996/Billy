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

// Clay only stores items that have a messageKey, and by default it sends every one of them to the
// watch. We take over Clay's event handling so that:
// - only the settings the watch actually reads are sent by AppMessage (an allowlist), and
// - stored secrets are never written into the generated config page URL. The page gets a
//   placeholder instead; saving the placeholder keeps the stored value, an empty field clears it.
// After saving, changed server settings are checked (see server_check.js).

var quickPrompts = require('./quick_prompts');
var serverCheck = require('./server_check');

var STORAGE_KEY = 'clay-settings';

exports.SECRET_KEYS = ['CF_ACCESS_CLIENT_ID', 'CF_ACCESS_CLIENT_SECRET'];
exports.WATCH_KEYS = ['QUICK_LAUNCH_BEHAVIOUR', 'ALARM_VIBE_PATTERN', 'TIMER_VIBE_PATTERN', 'CONFIRM_TRANSCRIPTS'];
exports.SECRET_PLACEHOLDER = '__buddy_unchanged__';

function load(storage) {
    try {
        return JSON.parse(storage.getItem(STORAGE_KEY)) || {};
    } catch (e) {
        return {};
    }
}

function copy(settings) {
    var result = {};
    for (var key in settings) {
        if (settings.hasOwnProperty(key)) {
            result[key] = settings[key];
        }
    }
    return result;
}

exports.maskSecrets = function(settings) {
    var masked = copy(settings);
    exports.SECRET_KEYS.forEach(function(key) {
        if (masked[key]) {
            masked[key] = exports.SECRET_PLACEHOLDER;
        }
    });
    return masked;
};

exports.restoreSecrets = function(submitted, previous) {
    var merged = copy(submitted);
    exports.SECRET_KEYS.forEach(function(key) {
        if (merged[key] === exports.SECRET_PLACEHOLDER) {
            merged[key] = previous[key] || '';
        }
    });
    return merged;
};

exports.buildWatchMessage = function(settings) {
    var message = {};
    exports.WATCH_KEYS.forEach(function(key) {
        if (!settings.hasOwnProperty(key)) {
            return;
        }
        var value = settings[key];
        if (typeof value === 'boolean') {
            value = value ? 1 : 0;
        }
        if (value === null || value === undefined) {
            return;
        }
        message[key] = value;
    });
    var prompts = quickPrompts.buildMessage(settings);
    message.QUICK_PROMPTS_LANG = prompts.QUICK_PROMPTS_LANG;
    message.QUICK_PROMPTS_CUSTOM = prompts.QUICK_PROMPTS_CUSTOM;
    return message;
};

// Clay pastes the page data in with String#replace (where dollar patterns are special) into an
// inline script, so text from the server must not carry those characters.
function pageText(value) {
    return String(value || '').replace(/[\u0024<>]/g, '');
}

// What the settings page shows about the last server check, or null.
exports.serverCheckForPage = function(result) {
    if (!result) {
        return null;
    }
    return {
        ok: !!result.ok,
        message: pageText(result.message),
        model: pageText(result.model),
        ms: Number(result.ms) || 0,
        time: Number(result.time) || 0
    };
};

exports.generateUrl = function(clay, storage) {
    if (clay.meta) {
        clay.meta.userData = {serverCheck: exports.serverCheckForPage(serverCheck.lastResult(storage))};
    }
    var raw = storage.getItem(STORAGE_KEY);
    storage.setItem(STORAGE_KEY, JSON.stringify(exports.maskSecrets(load(storage))));
    try {
        return clay.generateUrl();
    } finally {
        if (raw === null || raw === undefined) {
            storage.removeItem(STORAGE_KEY);
        } else {
            storage.setItem(STORAGE_KEY, raw);
        }
    }
};

// Returns the AppMessage that should be sent to the watch, or null if the page was cancelled.
exports.handleResponse = function(clay, storage, response) {
    if (!response) {
        return null;
    }
    var previous = load(storage);
    // Parses the page response and writes the flattened values to localStorage.
    clay.getSettings(response, false);
    var stored = exports.restoreSecrets(load(storage), previous);
    storage.setItem(STORAGE_KEY, JSON.stringify(stored));
    return exports.buildWatchMessage(stored);
};

exports.install = function(clay, storage, pebble) {
    pebble.addEventListener('showConfiguration', function() {
        pebble.openURL(exports.generateUrl(clay, storage));
    });
    pebble.addEventListener('webviewclosed', function(e) {
        var before = load(storage);
        var message = exports.handleResponse(clay, storage, e && e.response);
        if (!message) {
            return;
        }
        pebble.sendAppMessage(message, function() {
            console.log('Sent watch settings to Pebble.');
        }, function() {
            console.log('Failed to send watch settings to Pebble.');
        });
        if (serverCheck.shouldRun(before, load(storage), serverCheck.lastResult(storage))) {
            serverCheck.run({storage: storage}, function(result) {
                if (typeof pebble.showSimpleNotificationOnPebble === 'function') {
                    pebble.showSimpleNotificationOnPebble('Buddy', serverCheck.notificationText(result));
                }
            });
        }
    });
};
