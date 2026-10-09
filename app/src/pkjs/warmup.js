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

// Wakes the language model while the user is still speaking. The watch asks for this when Buddy
// opens to talk (not when it rings an alarm). We send the part every request starts with (system
// prompt and tool list) with max_tokens 1: a server that unloads idle models loads it again, and
// llama-server keeps that part in its prompt cache, so the real question only adds the rest.

var config = require('./config');
var llmClient = require('./agent/llm_client');
var promptBuilder = require('./agent/prompt');
var tools = require('./agent/tools');

var STORAGE_KEY = 'buddy-last-warmup';
// Opening Buddy again within a minute needs no new warm-up.
exports.MIN_INTERVAL_MS = 60 * 1000;

// The request a warm-up sends. Its start has to match a real request byte for byte.
exports.buildRequest = function() {
    return {
        messages: [
            {role: 'system', content: promptBuilder.buildSystemPrompt()},
            {role: 'user', content: 'Hi'}
        ],
        tools: tools.getDeclarations(),
        toolChoice: 'auto',
        maxTokens: 1,
        stream: false
    };
};

exports.run = function(options, callback) {
    options = options || {};
    callback = callback || function() {};
    var storage = options.storage || localStorage;
    var now = options.now || function() { return Date.now(); };
    if (!config.isLlmConfigured()) {
        callback('not_configured');
        return;
    }
    var last = parseInt(storage.getItem(STORAGE_KEY), 10) || 0;
    var started = now();
    if (started - last < exports.MIN_INTERVAL_MS) {
        callback('recent');
        return;
    }
    storage.setItem(STORAGE_KEY, String(started));
    var client = options.client || llmClient.createClient();
    client.complete(exports.buildRequest(), function(err) {
        if (err) {
            // Nothing to show: the real question reports problems itself.
            console.log('Warm-up failed: ' + err.message);
            callback('failed');
            return;
        }
        console.log('Warm-up done in ' + (now() - started) + ' ms.');
        callback('done');
    });
};
