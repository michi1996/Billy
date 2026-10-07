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

var PREFIX = 'benny-thread:';
// Only a few turns: each one costs prompt tokens and latency on a 14B model.
var MAX_TURNS = 3;
var MAX_STORED_CHARS = 400;

function randomHex(count) {
    var out = '';
    for (var i = 0; i < count; i++) {
        out += Math.floor(Math.random() * 16).toString(16);
    }
    return out;
}

function createThreadId() {
    return [
        randomHex(8),
        randomHex(4),
        '4' + randomHex(3),
        (8 + Math.floor(Math.random() * 4)).toString(16) + randomHex(3),
        randomHex(12)
    ].join('-');
}

function load(threadId) {
    if (!threadId) {
        return [];
    }
    try {
        var raw = localStorage.getItem(PREFIX + threadId);
        return raw ? JSON.parse(raw) : [];
    } catch (e) {
        console.log('Failed to load local thread: ' + e.message);
        return [];
    }
}

function save(threadId, turns) {
    if (!threadId) {
        return;
    }
    try {
        localStorage.setItem(PREFIX + threadId, JSON.stringify(turns.slice(-MAX_TURNS)));
    } catch (e) {
        console.log('Failed to save local thread: ' + e.message);
    }
}

exports.ensureThreadId = function(session) {
    if (session.threadId) {
        return session.threadId;
    }
    session.threadId = createThreadId();
    session.handleMessage({data: 't' + session.threadId});
    return session.threadId;
}

function clip(text) {
    text = String(text || '');
    return text.length > MAX_STORED_CHARS ? text.substring(0, MAX_STORED_CHARS - 3) + '...' : text;
}

// Earlier turns of this thread as OpenAI chat messages (oldest first).
exports.buildMessages = function(threadId) {
    var messages = [];
    load(threadId).slice(-MAX_TURNS).forEach(function(turn) {
        messages.push({role: 'user', content: String(turn.user || '')});
        messages.push({role: 'assistant', content: String(turn.assistant || '')});
    });
    return messages;
}

exports.recordTurn = function(threadId, userPrompt, assistantText) {
    var turns = load(threadId);
    turns.push({
        user: clip(userPrompt),
        assistant: clip(assistantText)
    });
    save(threadId, turns);
}

exports.hasTurns = function(threadId) {
    return load(threadId).length > 0;
}
