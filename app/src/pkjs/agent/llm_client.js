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
// Cloudflare Access. The service token goes into request headers only: never into the URL,
// never into logs, never to the watch.

var config = require('../config');

var COMPLETIONS_PATH = '/v1/chat/completions';
// Extra time after xhr.timeout before we give up ourselves, in case a phone runtime ignores it.
var WATCHDOG_GRACE_MS = 2000;

var MESSAGES = {
    notConfigured: 'Set up the server in the app settings',
    unreachable: 'Server unreachable',
    accessDenied: 'Access denied - check the service token',
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
    body.stream = false;
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

function clip(text, max) {
    return text.length > max ? text.substring(0, max - 3) + '...' : text;
}

exports.mapHttpError = function(status, text, contentType, responseUrl) {
    if (!status) {
        return makeError('unreachable', MESSAGES.unreachable, 0);
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

    function complete(request, callback) {
        var settings = getSettings();
        if (!settings.baseUrl || !settings.clientId || !settings.clientSecret) {
            callback(makeError('not_configured', MESSAGES.notConfigured));
            return;
        }
        var timeoutMs = settings.timeoutSeconds * 1000;
        var started = now();
        var finished = false;
        var watchdog = null;
        var xhr = xhrFactory();

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

        xhr.open('POST', exports.buildUrl(settings.baseUrl), true);
        xhr.timeout = timeoutMs;
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.setRequestHeader('Accept', 'application/json');
        xhr.setRequestHeader('CF-Access-Client-Id', settings.clientId);
        xhr.setRequestHeader('CF-Access-Client-Secret', settings.clientSecret);
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
            var json;
            try {
                json = JSON.parse(text);
            } catch (e) {
                finish(makeError('access_denied', MESSAGES.accessDenied, status));
                return;
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

        log('LLM request: ' + request.messages.length + ' message(s), ' +
            (request.tools && request.tools.length ? 'tool_choice=' + (request.toolChoice || 'auto') : 'no tools'));
        xhr.send(JSON.stringify(exports.buildBody(settings, request)));
    }

    return {
        complete: complete
    };
};
