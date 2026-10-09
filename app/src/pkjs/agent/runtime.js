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
    empty: 'The model did not send an answer.',
    gaveUp: 'Sorry, I could not finish that request.'
};
exports.MESSAGES = MESSAGES;
exports.MAX_TOOL_ROUNDS = MAX_TOOL_ROUNDS;

function Runtime(session, options) {
    options = options || {};
    this.session = session;
    this.client = options.client || llmClient.createClient();
}

Runtime.prototype.run = function() {
    var runtime = this;
    var threadId = localHistory.ensureThreadId(this.session);
    if (config.isFastPathEnabled() && runFastPath(this.session, threadId, function() {
        runtime.runModel(threadId);
    })) {
        return;
    }
    this.runModel(threadId);
};

Runtime.prototype.runModel = function(threadId) {
    var session = this.session;
    var messages = [{role: 'system', content: promptBuilder.buildSystemPrompt()}]
        .concat(localHistory.buildMessages(threadId))
        .concat([{role: 'user', content: promptBuilder.buildUserMessage(session.prompt, clock.now())}]);
    var loop = {
        session: session,
        client: this.client,
        threadId: threadId,
        messages: messages,
        tools: tools.getDeclarations(),
        progress: startProgress(session),
        stream: config.isStreamingEnabled()
    };
    step(loop, 0);
};

// Simple timer/alarm commands are handled without the model (see fast_path.js). If the fast
// path finds the request ambiguous after all (text === null), the model takes over.
function runFastPath(session, threadId, askModel) {
    return fastPath.tryHandle(session, function(text, isError) {
        if (text === null) {
            askModel();
            return;
        }
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
    var writer = loop.stream ? new StreamWriter(loop) : null;
    loop.client.complete({
        messages: loop.messages,
        tools: loop.tools,
        toolChoice: forceAnswer ? 'none' : 'auto',
        stream: loop.stream,
        onContent: writer ? function(text) { writer.push(text); } : undefined
    }, function(err, response) {
        if (err) {
            if (writer && !writer.started && err.kind === 'server_error') {
                // Possibly a server that can't stream this request; ask again the old way.
                console.log('Streamed request failed (' + err.message + '); retrying without streaming.');
                loop.stream = false;
                step(loop, round);
                return;
            }
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
            if (writer) {
                // Text that came with the tool call ("Let me check...") is shown in full; the
                // progress line then closes that bubble.
                writer.finish(response.content || '');
                if (writer.started) {
                    loop.progress = startProgress(loop.session);
                }
            }
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
        if (writer && writer.started) {
            writer.finish(text);
        } else {
            streamText(loop.session, text);
        }
        finish(loop.session);
    });
}

var TOOL_CALL_MARKER = '<tool_call>';
// Send a piece once this much new text is ready, or at the end of a sentence or line.
var MIN_PIECE_CHARS = 24;

// Sends the answer to the watch while the model is still writing it. Pieces end at a word
// boundary and outside markdown markers, so the cleaned-up text only ever grows. Nothing is shown
// while the answer might still turn out to be a tool call written as text.
function StreamWriter(loop) {
    this.loop = loop;
    this.raw = '';
    this.cut = 0;
    this.shown = '';
    this.started = false;
    this.stopped = false;
}

StreamWriter.prototype.push = function(delta) {
    if (this.stopped) {
        return;
    }
    this.raw += delta;
    var limit = this.raw.indexOf(TOOL_CALL_MARKER);
    if (limit !== -1) {
        this.stopped = true;
    } else {
        limit = this.raw.length;
    }
    if (!this.started) {
        var lead = this.raw.replace(/^\s+/, '');
        if (!lead || lead.length < TOOL_CALL_MARKER.length && TOOL_CALL_MARKER.indexOf(lead) === 0) {
            return;
        }
    }
    // Before a tool call written as text everything up to it can go; otherwise keep back the last
    // word, which may still be growing.
    var cut = this.stopped && markersBalanced(this.raw, limit) ? limit : safeCut(this.raw, limit);
    var fresh = this.raw.substring(this.cut, cut);
    if (fresh.length < MIN_PIECE_CHARS && !/[.!?:]\s|\n/.test(fresh) && !this.stopped) {
        return;
    }
    this.show(formatting.cleanForWatch(this.raw.substring(0, cut), true));
    this.cut = cut;
};

// Sends what is still missing of the final answer.
StreamWriter.prototype.finish = function(text) {
    this.show(formatting.forWatch(text));
};

StreamWriter.prototype.show = function(cleaned) {
    var addition;
    if (cleaned.indexOf(this.shown) === 0) {
        addition = cleaned.substring(this.shown.length);
    } else {
        // The cleanup changed text that is already on the watch (should not happen).
        console.log('Streamed text diverged; sending the rest by position.');
        addition = cleaned.substring(Math.min(this.shown.length, cleaned.length));
    }
    if (!addition) {
        return;
    }
    if (!this.started) {
        this.started = true;
        this.loop.progress.done();
    }
    this.shown = cleaned;
    sendChunks(this.loop.session, addition);
};

// Where the text before `limit` can be cut: the last start of a word with balanced markdown
// markers (*, _ and `) before it. One pass over the text.
function safeCut(raw, limit) {
    var cut = 0;
    scanMarkers(raw, limit, function(i, balanced) {
        if (balanced && i > 0 && /\s/.test(raw.charAt(i - 1)) && !/\s/.test(raw.charAt(i))) {
            cut = i;
        }
    });
    return cut;
}

function markersBalanced(raw, limit) {
    return scanMarkers(raw, limit, function() {});
}

// Calls visit(i, balanced) for each position before `limit`, where `balanced` says whether the
// markers before position i are paired up. A "* " at the start of a line is a list bullet, not a
// marker. Returns whether the markers before `limit` are balanced.
function scanMarkers(raw, limit, visit) {
    var counts = {star: 0, underscore: 0, backtick: 0};
    var lineStart = true;
    for (var i = 0; i < limit; i++) {
        var c = raw.charAt(i);
        visit(i, counts.star % 2 === 0 && counts.underscore % 2 === 0 && counts.backtick % 2 === 0);
        if (c === '*' && !(lineStart && raw.charAt(i + 1) === ' ')) {
            counts.star++;
        } else if (c === '_') {
            counts.underscore++;
        } else if (c === '`') {
            counts.backtick++;
        }
        lineStart = c === '\n' || (lineStart && (c === ' ' || c === '\t'));
    }
    return counts.star % 2 === 0 && counts.underscore % 2 === 0 && counts.backtick % 2 === 0;
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
    sendChunks(session, formatting.forWatch(text));
}

// Sends text in pieces of at most CHUNK_CHARS characters (the watch appends them).
function sendChunks(session, text) {
    text = text.replace(/\u202f/g, '\u00a0');
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
