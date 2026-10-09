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

// Client for llama-server's OpenAI-compatible /v1/chat/completions endpoint behind
// Cloudflare Access. The service token (and llama-server's optional API key) go into request
// headers only: never into the URL, never into logs, never to the watch.

var config = require('../config');

var COMPLETIONS_PATH = '/v1/chat/completions';
// Extra time after xhr.timeout before we give up ourselves, in case a phone runtime ignores it.
var WATCHDOG_GRACE_MS = 2000;

var MESSAGES = {
    notConfigured: 'Set up the server in the app settings',
    unreachable: 'Server unreachable',
    accessDenied: 'Access denied - check the service token',
    apiKeyDenied: 'Access denied - check the API key',
    tooSlow: 'The model took too long',
    invalidResponse: 'Invalid response from the server'
};
exports.MESSAGES = MESSAGES;

// Cloudflare answers with these when the tunnel or origin is down.
var UNREACHABLE_STATUSES = [502, 521, 522, 523, 530];

function makeError(kind, message, status) {
    var err = new Error(message);
    err.kind = kind;
    if (status !== undefined) {
        err.status = status;
    }
    return err;
}

exports.buildUrl = function(baseUrl) {
    return String(baseUrl || '').replace(/\/+$/, '') + COMPLETIONS_PATH;
};

exports.buildBody = function(settings, request) {
    var body = {
        model: settings.model,
        messages: request.messages
    };
    // Requests without tools (the server check) leave out the tool fields entirely.
    if (request.tools && request.tools.length) {
        body.tools = request.tools;
        body.tool_choice = request.toolChoice || 'auto';
        body.parallel_tool_calls = false;
    }
    body.temperature = 0.2;
    body.max_tokens = request.maxTokens || 300;
    body.stream = !!request.stream;
    body.cache_prompt = true;
    return body;
};

function looksLikeHtml(text, contentType, responseUrl) {
    if (contentType && /text\/html/i.test(contentType)) {
        return true;
    }
    if (responseUrl && /cloudflareaccess\.com/i.test(responseUrl)) {
        return true;
    }
    return /^\s*</.test(text || '');
}

// The error text from a JSON error body ({"error": {"message": ...}} from llama-server and
// most OpenAI-compatible servers), so the user can see why the server refused. HTML error
// pages are ignored.
exports.errorDetail = function(text, contentType) {
    if (!text || looksLikeHtml(text, contentType)) {
        return '';
    }
    var detail = '';
    try {
        var body = JSON.parse(text);
        if (body && body.error && typeof body.error.message === 'string') {
            detail = body.error.message;
        } else if (body && typeof body.error === 'string') {
            detail = body.error;
        } else if (body && typeof body.message === 'string') {
            detail = body.message;
        } else if (body && typeof body.detail === 'string') {
            detail = body.detail;
        }
    } catch (e) {
        detail = '';
    }
    return detail.replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
};

// llama-server's answer to a missing or wrong --api-key:
// {"error": {"code": 401, "message": "Invalid API Key", "type": "authentication_error"}}
function isApiKeyError(text, contentType) {
    if (/authentication_error/.test(text || '')) {
        return true;
    }
    return /api key/i.test(exports.errorDetail(text, contentType));
}

function clip(text, max) {
    return text.length > max ? text.substring(0, max - 3) + '...' : text;
}

exports.mapHttpError = function(status, text, contentType, responseUrl) {
    if (!status) {
        return makeError('unreachable', MESSAGES.unreachable, 0);
    }
    if (status === 401 && isApiKeyError(text, contentType)) {
        return makeError('access_denied', MESSAGES.apiKeyDenied, status);
    }
    if (status === 401 || status === 403 || (status >= 300 && status < 400)) {
        return makeError('access_denied', MESSAGES.accessDenied, status);
    }
    if (status === 524) {
        return makeError('too_slow', MESSAGES.tooSlow, status);
    }
    if (UNREACHABLE_STATUSES.indexOf(status) !== -1) {
        return makeError('unreachable', MESSAGES.unreachable + ' (' + status + ')', status);
    }
    if (status < 200 || status >= 300) {
        var detail = exports.errorDetail(text, contentType);
        var err = makeError('server_error', 'Server error (' + status + ')' + (detail ? ': ' + clip(detail, 80) : ''), status);
        err.detail = detail;
        return err;
    }
    if (looksLikeHtml(text, contentType, responseUrl)) {
        // Access redirected us to its login page and the XHR followed the redirect.
        return makeError('access_denied', MESSAGES.accessDenied, status);
    }
    return null;
};

function parseArguments(raw) {
    if (raw === undefined || raw === null || raw === '') {
        return {value: {}};
    }
    if (typeof raw === 'object') {
        return Array.isArray(raw) ? {error: 'arguments must be a JSON object'} : {value: raw};
    }
    var parsed;
    try {
        parsed = JSON.parse(String(raw));
    } catch (e) {
        return {error: 'arguments are not valid JSON'};
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return {error: 'arguments must be a JSON object'};
    }
    return {value: parsed};
}

function normalizeToolCall(call, index) {
    var fn = (call && call['function']) || {};
    var parsed = parseArguments(fn.arguments);
    var rawArguments = typeof fn.arguments === 'string' ? fn.arguments : JSON.stringify(fn.arguments || {});
    return {
        id: call && call.id ? String(call.id) : 'call_' + index,
        name: String(fn.name || ''),
        rawArguments: rawArguments,
        arguments: parsed.value || null,
        argumentsError: parsed.error || null
    };
}

// Some chat templates leave Qwen's <tool_call>{...}</tool_call> blocks in the text instead of
// returning tool_calls. Recover them so the model still gets to use its tools.
function extractInlineToolCalls(content) {
    var calls = [];
    var regex = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;
    var match;
    while ((match = regex.exec(content)) !== null) {
        var name = '';
        var args = '{}';
        try {
            var parsed = JSON.parse(match[1]);
            name = parsed.name || '';
            args = parsed.arguments === undefined ? '{}' : parsed.arguments;
        } catch (e) {
            name = '';
            args = match[1];
        }
        calls.push({
            id: 'call_inline_' + calls.length,
            type: 'function',
            'function': {name: name, arguments: args}
        });
    }
    return {
        calls: calls,
        content: calls.length > 0 ? content.replace(regex, '').replace(/^\s+|\s+$/g, '') : content
    };
}

exports.parseResponse = function(json) {
    var choice = json && json.choices && json.choices[0];
    var message = choice && choice.message;
    if (!message) {
        return null;
    }
    var content = typeof message.content === 'string' ? message.content : '';
    var rawCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    if (rawCalls.length === 0 && content.indexOf('<tool_call>') !== -1) {
        var inline = extractInlineToolCalls(content);
        rawCalls = inline.calls;
        content = inline.content;
    }
    var toolCalls = [];
    for (var i = 0; i < rawCalls.length; i++) {
        toolCalls.push(normalizeToolCall(rawCalls[i], i));
    }
    return {
        content: content,
        toolCalls: toolCalls,
        finishReason: choice.finish_reason || null,
        model: typeof json.model === 'string' ? json.model : null
    };
};

// Reads a streamed answer (server-sent events): "data: {chunk}" lines with deltas, "data: [DONE]"
// at the end, and "error: {...}" from llama-server if generation fails. Text deltas are handed to
// onContent as they arrive; toJson() gives the whole answer in the non-streamed format.
function StreamParser(onContent) {
    this.onContent = onContent;
    this.offset = 0;
    this.pending = '';
    this.sawData = false;
    this.content = '';
    this.toolCalls = [];
    this.finishReason = null;
    this.model = null;
    this.error = null;
}

// Takes the whole response text received so far. Returns true if something new arrived.
StreamParser.prototype.feed = function(text) {
    if (text.length <= this.offset) {
        return false;
    }
    this.pending += text.substring(this.offset);
    this.offset = text.length;
    var lines = this.pending.split('\n');
    this.pending = lines.pop();
    for (var i = 0; i < lines.length; i++) {
        this.line(lines[i]);
    }
    return true;
};

StreamParser.prototype.end = function() {
    if (this.pending) {
        this.line(this.pending);
        this.pending = '';
    }
};

StreamParser.prototype.line = function(line) {
    var match = /^(data|error):\s?(.*?)\r?$/.exec(line);
    if (!match || match[2] === '[DONE]') {
        return;
    }
    var chunk;
    try {
        chunk = JSON.parse(match[2]);
    } catch (e) {
        return;
    }
    if (match[1] === 'error' || (chunk && chunk.error)) {
        var error = chunk && chunk.error !== undefined ? chunk.error : chunk;
        this.error = typeof error === 'string' ? error : (error && error.message) || 'generation failed';
        return;
    }
    if (!chunk) {
        return;
    }
    this.sawData = true;
    if (typeof chunk.model === 'string') {
        this.model = chunk.model;
    }
    var choice = chunk.choices && chunk.choices[0];
    if (!choice) {
        return;
    }
    var delta = choice.delta || choice.message || {};
    if (typeof delta.content === 'string' && delta.content) {
        this.content += delta.content;
        this.onContent(delta.content);
    }
    var calls = Array.isArray(delta.tool_calls) ? delta.tool_calls : [];
    for (var i = 0; i < calls.length; i++) {
        this.addToolCall(calls[i], i);
    }
    if (choice.finish_reason) {
        this.finishReason = choice.finish_reason;
    }
};

// Tool calls arrive in pieces: id and name first, then the arguments a few characters at a time.
StreamParser.prototype.addToolCall = function(part, position) {
    var index = typeof part.index === 'number' ? part.index : position;
    var call = this.toolCalls[index];
    if (!call) {
        call = this.toolCalls[index] = {id: '', name: '', arguments: ''};
    }
    var fn = part['function'] || {};
    if (part.id) {
        call.id = String(part.id);
    }
    if (typeof fn.name === 'string') {
        call.name += fn.name;
    }
    if (typeof fn.arguments === 'string') {
        call.arguments += fn.arguments;
    }
};

StreamParser.prototype.toJson = function() {
    var message = {role: 'assistant', content: this.content};
    var calls = [];
    for (var i = 0; i < this.toolCalls.length; i++) {
        var call = this.toolCalls[i];
        if (call && call.name) {
            calls.push({id: call.id, type: 'function', 'function': {name: call.name, arguments: call.arguments}});
        }
    }
    if (calls.length) {
        message.tool_calls = calls;
    }
    return {model: this.model, choices: [{index: 0, message: message, finish_reason: this.finishReason}]};
};

function defaultXhrFactory() {
    return new XMLHttpRequest();
}

function getHeader(xhr, name) {
    try {
        return xhr.getResponseHeader ? xhr.getResponseHeader(name) : null;
    } catch (e) {
        return null;
    }
}

exports.createClient = function(options) {
    options = options || {};
    var xhrFactory = options.xhrFactory || defaultXhrFactory;
    var getSettings = options.getSettings || config.getLlmSettings;
    var log = options.log || function(text) { console.log(text); };
    var schedule = options.setTimeout || function(fn, ms) { return setTimeout(fn, ms); };
    var unschedule = options.clearTimeout || function(handle) { clearTimeout(handle); };
    var now = options.now || function() { return Date.now(); };

    // With request.stream the answer is read while it is being written and every text delta is
    // handed to request.onContent; the callback still gets the complete answer at the end.
    function complete(request, callback) {
        var settings = getSettings();
        if (!settings.baseUrl || !settings.clientId || !settings.clientSecret) {
            callback(makeError('not_configured', MESSAGES.notConfigured));
            return;
        }
        var timeoutMs = settings.timeoutSeconds * 1000;
        var streaming = !!request.stream;
        var started = now();
        var finished = false;
        var watchdog = null;
        var xhr = xhrFactory();
        var stream = null;
        var gotText = false;
        if (streaming) {
            stream = new StreamParser(function(text) {
                if (!gotText) {
                    gotText = true;
                    log('LLM stream: first text after ' + (now() - started) + ' ms');
                }
                if (request.onContent) {
                    request.onContent(text);
                }
            });
        }

        function finish(err, value) {
            if (finished) {
                return;
            }
            finished = true;
            if (watchdog !== null) {
                unschedule(watchdog);
                watchdog = null;
            }
            callback(err, value);
        }

        // Without streaming the whole request has to finish within the timeout. With streaming the
        // server only has to keep sending: the watchdog restarts whenever new data arrives.
        function armWatchdog() {
            if (watchdog !== null) {
                unschedule(watchdog);
            }
            watchdog = schedule(function() {
                watchdog = null;
                if (finished) {
                    return;
                }
                log('LLM request watchdog fired after ' + (now() - started) + ' ms.');
                try {
                    xhr.abort();
                } catch (e) {
                    // Nothing else to do.
                }
                finish(makeError('unreachable', MESSAGES.unreachable, 0));
            }, timeoutMs + WATCHDOG_GRACE_MS);
        }

        function readStream() {
            if (finished || xhr.status !== 200) {
                return;
            }
            var text;
            try {
                text = xhr.responseText || '';
            } catch (e) {
                return;
            }
            if (stream.feed(text)) {
                armWatchdog();
            }
        }

        xhr.open('POST', exports.buildUrl(settings.baseUrl), true);
        // A streamed answer may take longer than the timeout in total; the watchdog covers stalls.
        xhr.timeout = streaming ? 0 : timeoutMs;
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.setRequestHeader('Accept', streaming ? 'text/event-stream' : 'application/json');
        xhr.setRequestHeader('CF-Access-Client-Id', settings.clientId);
        xhr.setRequestHeader('CF-Access-Client-Secret', settings.clientSecret);
        if (settings.apiKey) {
            xhr.setRequestHeader('Authorization', 'Bearer ' + settings.apiKey);
        }
        if (streaming) {
            xhr.onprogress = readStream;
            xhr.onreadystatechange = function() {
                if (xhr.readyState === 3) {
                    readStream();
                }
            };
        }
        xhr.onload = function() {
            if (xhr.readyState !== undefined && xhr.readyState !== 4) {
                return;
            }
            var status = xhr.status;
            var text = xhr.responseText || '';
            var contentType = getHeader(xhr, 'Content-Type') || '';
            log('LLM response: HTTP ' + status + ', ' + text.length + ' bytes, ' + (now() - started) + ' ms');
            var httpError = exports.mapHttpError(status, text, contentType, xhr.responseURL);
            if (httpError) {
                if (httpError.detail) {
                    log('LLM server error: ' + clip(httpError.detail, 300));
                }
                finish(httpError);
                return;
            }
            var json = null;
            if (stream) {
                stream.feed(text);
                stream.end();
                if (stream.error) {
                    log('LLM server error: ' + clip(stream.error, 300));
                    var streamError = makeError('server_error', 'Server error: ' + clip(stream.error, 80), status);
                    streamError.detail = stream.error;
                    finish(streamError);
                    return;
                }
                if (stream.sawData) {
                    json = stream.toJson();
                }
            }
            if (!json) {
                // Not streamed (streaming off, or a server that ignores it): one JSON document.
                try {
                    json = JSON.parse(text);
                } catch (e) {
                    finish(makeError('access_denied', MESSAGES.accessDenied, status));
                    return;
                }
            }
            var parsed = exports.parseResponse(json);
            if (!parsed) {
                finish(makeError('invalid_response', MESSAGES.invalidResponse, status));
                return;
            }
            log('LLM result: ' + parsed.toolCalls.length + ' tool call(s), ' + parsed.content.length + ' chars');
            finish(null, parsed);
        };
        xhr.onerror = function() {
            log('LLM request failed before a response (' + (now() - started) + ' ms).');
            finish(makeError('unreachable', MESSAGES.unreachable, 0));
        };
        xhr.ontimeout = function() {
            log('LLM request timed out after ' + (now() - started) + ' ms.');
            finish(makeError('unreachable', MESSAGES.unreachable, 0));
        };
        armWatchdog();

        log('LLM request: ' + request.messages.length + ' message(s), ' +
            (request.tools && request.tools.length ? 'tool_choice=' + (request.toolChoice || 'auto') : 'no tools') +
            (streaming ? ', streaming' : ''));
        xhr.send(JSON.stringify(exports.buildBody(settings, request)));
    }

    return {
        complete: complete
    };
};
