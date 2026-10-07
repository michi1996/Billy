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

// The agent loop: one user prompt -> chat completions with tool calls -> a short watch reply.
// Derived from Billy's runtime, now speaking the OpenAI chat message format.

var clock = require('./clock');
var config = require('../config');
var fastPath = require('./fast_path');
var formatting = require('./formatting');
var llmClient = require('./llm_client');
var localHistory = require('./local_history');
var promptBuilder = require('./prompt');
var tools = require('./tools');

var MAX_TOOL_ROUNDS = 3;
var CHUNK_CHARS = 80;

var MESSAGES = {
    empty: 'Keine Antwort vom Modell erhalten.',
    gaveUp: 'Ich konnte die Anfrage nicht abschliessen.'
};
exports.MESSAGES = MESSAGES;
exports.MAX_TOOL_ROUNDS = MAX_TOOL_ROUNDS;

function Runtime(session, options) {
    options = options || {};
    this.session = session;
    this.client = options.client || llmClient.createClient();
}

Runtime.prototype.run = function() {
    var session = this.session;
    var threadId = localHistory.ensureThreadId(session);
    if (config.isFastPathEnabled() && runFastPath(session, threadId)) {
        return;
    }
    var messages = [{role: 'system', content: promptBuilder.buildSystemPrompt()}]
        .concat(localHistory.buildMessages(threadId))
        .concat([{role: 'user', content: promptBuilder.buildUserMessage(session.prompt, clock.now())}]);
    var loop = {
        session: session,
        client: this.client,
        threadId: threadId,
        messages: messages,
        tools: tools.getDeclarations(),
        progress: startProgress(session)
    };
    step(loop, 0);
};

// Simple timer/alarm commands are handled without the model (see fast_path.js).
function runFastPath(session, threadId) {
    return fastPath.tryHandle(session, function(text, isError) {
        localHistory.recordTurn(threadId, session.prompt, text);
        if (isError) {
            fail(session, text);
            return;
        }
        streamText(session, text);
        finish(session);
    });
}

function step(loop, round) {
    // After MAX_TOOL_ROUNDS rounds of tools the model has to answer with text.
    var forceAnswer = round >= MAX_TOOL_ROUNDS;
    loop.client.complete({
        messages: loop.messages,
        tools: loop.tools,
        toolChoice: forceAnswer ? 'none' : 'auto'
    }, function(err, response) {
        if (err) {
            loop.progress.done();
            fail(loop.session, err.message);
            return;
        }
        if (response.toolCalls.length > 0 && !forceAnswer) {
            loop.messages.push({
                role: 'assistant',
                content: response.content || '',
                tool_calls: response.toolCalls.map(function(call) {
                    return {
                        id: call.id,
                        type: 'function',
                        'function': {name: call.name, arguments: call.rawArguments}
                    };
                })
            });
            executeToolCalls(loop, response.toolCalls, function(stopInfo) {
                if (stopInfo) {
                    loop.progress.done();
                    localHistory.recordTurn(loop.threadId, loop.session.prompt, stopInfo.question || '');
                    return;
                }
                loop.progress.update('Writing the answer');
                step(loop, round + 1);
            });
            return;
        }
        var text = String(response.content || '').replace(/^\s+|\s+$/g, '');
        if (!text) {
            text = forceAnswer ? MESSAGES.gaveUp : MESSAGES.empty;
        }
        localHistory.recordTurn(loop.threadId, loop.session.prompt, text);
        loop.progress.done();
        streamText(loop.session, text);
        finish(loop.session);
    });
}

// Runs the calls one after another and appends a tool message for each. Stops early (and
// calls back with info) if a tool hands control to the user, e.g. the clarification picker.
function executeToolCalls(loop, calls, callback) {
    var index = 0;
    function next() {
        if (index >= calls.length) {
            callback(null);
            return;
        }
        var call = calls[index++];
        console.log('Running tool ' + call.name);
        tools.execute(loop.session, call, function(result) {
            if (result && result.stop_for_user) {
                callback({question: call.arguments && call.arguments.question});
                return;
            }
            loop.messages.push({
                role: 'tool',
                tool_call_id: call.id,
                content: JSON.stringify(result === undefined ? null : result)
            });
            next();
        });
    }
    next();
}

function startProgress(session) {
    var active = true;
    var timers = [];

    function update(text) {
        if (!active) {
            return;
        }
        session.handleMessage({data: 'f' + text});
    }

    update('Thinking');
    timers.push(setTimeout(function() {
        update('Still thinking');
    }, 8000));
    timers.push(setTimeout(function() {
        update('Still working');
    }, 25000));

    return {
        update: update,
        done: function() {
            active = false;
            timers.forEach(function(timer) {
                clearTimeout(timer);
            });
            timers = [];
        }
    };
}

function fail(session, message) {
    session.handleMessage({data: 'w' + message});
    finish(session);
}

function finish(session) {
    session.handleMessage({data: 'd'});
    session.handleClose({
        code: 1000,
        reason: '',
        wasClean: true
    });
}

function streamText(session, text) {
    text = formatting.forWatch(text).replace(/ /g, ' ');
    var chunk = '';
    for (var i = 0; i < text.length; i++) {
        var next = text[i];
        if (chunk.length > 0 && (chunk + next).length > CHUNK_CHARS) {
            session.handleMessage({data: 'c' + chunk});
            chunk = '';
        }
        chunk += next;
    }
    if (chunk.length > 0) {
        session.handleMessage({data: 'c' + chunk});
    }
}

exports.Runtime = Runtime;
exports.streamText = streamText;
exports.finish = finish;
exports.fail = fail;
