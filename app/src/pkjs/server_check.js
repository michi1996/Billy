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

// Checks the server settings right after they are saved: one tiny chat completion (one word in,
// one token out) with the saved URL, service token and model. That covers the tunnel, Cloudflare
// Access, the model name and the model itself. The result goes to the watch as a notification and
// is kept for the settings page; it never contains the service token.

var config = require('./config');
var llmClient = require('./agent/llm_client');

var STORAGE_KEY = 'buddy-server-check';

// Settings that change which server, token or model is used.
exports.SERVER_KEYS = ['LLM_BASE_URL', 'CF_ACCESS_CLIENT_ID', 'CF_ACCESS_CLIENT_SECRET', 'LLM_MODEL'];

exports.lastResult = function(storage) {
    try {
        return JSON.parse(storage.getItem(STORAGE_KEY)) || null;
    } catch (e) {
        return null;
    }
};

// Check again when the server settings changed, or when the last check failed (saving again is
// the natural way to retry).
exports.shouldRun = function(before, after, last) {
    if (!config.isLlmConfigured()) {
        return false;
    }
    var changed = exports.SERVER_KEYS.some(function(key) {
        return (before[key] || '') !== (after[key] || '');
    });
    return changed || !last || !last.ok;
};

exports.run = function(options, callback) {
    options = options || {};
    var storage = options.storage || localStorage;
    var now = options.now || function() { return Date.now(); };
    var client = options.client || llmClient.createClient();
    var started = now();
    client.complete({messages: [{role: 'user', content: 'Hi'}], maxTokens: 1}, function(err, response) {
        var result;
        if (err) {
            result = {ok: false, message: err.message, time: now()};
            console.log('Server check failed: ' + err.message);
        } else {
            result = {
                ok: true,
                model: response.model || config.getLlmModel(),
                ms: now() - started,
                time: now()
            };
            console.log('Server check OK (' + result.ms + ' ms).');
        }
        storage.setItem(STORAGE_KEY, JSON.stringify(result));
        callback(result);
    });
};

exports.notificationText = function(result) {
    if (!result.ok) {
        return 'Server check failed\n' + result.message;
    }
    return 'Server OK\n' + result.model + ', ' + (result.ms / 1000).toFixed(1) + ' s';
};
