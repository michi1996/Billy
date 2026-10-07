// Minimal test harness for the PebbleKit JS code. No dependencies beyond Node itself.
// Runs every test synchronously with fake timers and fresh Pebble/localStorage globals.
'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');

const APP_DIR = path.join(__dirname, '..');
const PKJS_DIR = path.join(APP_DIR, 'src', 'pkjs');

// pebble build provides `message_keys` and `package.json` as virtual modules.
const stubDir = path.join(__dirname, '.stubs');
fs.mkdirSync(stubDir, {recursive: true});
const packageJson = JSON.parse(fs.readFileSync(path.join(APP_DIR, 'package.json'), 'utf8'));
const messageKeys = {};
let nextKey = 10000;
packageJson.pebble.messageKeys.forEach((entry) => {
    const match = /^(\w+)(?:\[(\d+)\])?$/.exec(entry.trim());
    messageKeys[match[1]] = nextKey;
    nextKey += match[2] ? parseInt(match[2], 10) : 1;
});
fs.writeFileSync(path.join(stubDir, 'message_keys.js'), 'module.exports = ' + JSON.stringify(messageKeys) + ';\n');
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, isMain, options) {
    if (request === 'message_keys') {
        return path.join(stubDir, 'message_keys.js');
    }
    if (request === 'package.json' && parent && parent.filename && parent.filename.indexOf(PKJS_DIR) === 0) {
        return path.join(APP_DIR, 'package.json');
    }
    return originalResolve.call(this, request, parent, isMain, options);
};

function pkjs(relative) {
    return require(path.join(PKJS_DIR, relative));
}

// ---- fake timers ----
function FakeClock() {
    this.nowMs = 0;
    this.timers = [];
    this.nextId = 1;
}
FakeClock.prototype.setTimeout = function(fn, ms) {
    const id = this.nextId++;
    this.timers.push({id: id, at: this.nowMs + (ms || 0), fn: fn});
    return id;
};
FakeClock.prototype.clearTimeout = function(id) {
    this.timers = this.timers.filter((t) => t.id !== id);
};
FakeClock.prototype.tick = function(ms) {
    const target = this.nowMs + ms;
    for (;;) {
        const due = this.timers.filter((t) => t.at <= target).sort((a, b) => a.at - b.at)[0];
        if (!due) {
            break;
        }
        this.timers = this.timers.filter((t) => t !== due);
        this.nowMs = due.at;
        due.fn();
    }
    this.nowMs = target;
};
FakeClock.prototype.pending = function() {
    return this.timers.length;
};

// ---- localStorage ----
function MemoryStorage() {
    this.data = {};
}
MemoryStorage.prototype.getItem = function(key) {
    return Object.prototype.hasOwnProperty.call(this.data, key) ? this.data[key] : null;
};
MemoryStorage.prototype.setItem = function(key, value) {
    this.data[key] = String(value);
};
MemoryStorage.prototype.removeItem = function(key) {
    delete this.data[key];
};

// ---- Pebble ----
function FakePebble() {
    this.platform = 'emery';
    this.listeners = {};
    this.sent = [];
    this.timelineTokenOk = true;
    this.openedUrls = [];
}
FakePebble.prototype.addEventListener = function(name, fn) {
    (this.listeners[name] = this.listeners[name] || []).push(fn);
};
FakePebble.prototype.removeEventListener = function(name, fn) {
    this.listeners[name] = (this.listeners[name] || []).filter((f) => f !== fn);
};
FakePebble.prototype.dispatch = function(name, event) {
    (this.listeners[name] || []).slice().forEach((fn) => fn(event));
};
FakePebble.prototype.sendAppMessage = function(message, ok) {
    this.sent.push(message);
    if (ok) {
        ok();
    }
};
FakePebble.prototype.getTimelineToken = function(ok, fail) {
    if (this.timelineTokenOk) {
        ok('timeline-token');
    } else {
        fail('no token');
    }
};
FakePebble.prototype.openURL = function(url) {
    this.openedUrls.push(url);
};

// ---- XMLHttpRequest ----
function MockXhr() {
    this.headers = {};
    this.responseHeaders = {};
    this.sentBody = null;
    this.aborted = false;
    this.readyState = 0;
}
MockXhr.prototype.open = function(method, url, async) {
    this.method = method;
    this.url = url;
    this.async = async;
};
MockXhr.prototype.setRequestHeader = function(name, value) {
    this.headers[name] = value;
};
MockXhr.prototype.getResponseHeader = function(name) {
    const key = Object.keys(this.responseHeaders).find((k) => k.toLowerCase() === name.toLowerCase());
    return key ? this.responseHeaders[key] : null;
};
MockXhr.prototype.send = function(body) {
    this.sentBody = body;
    if (this.autoRespond) {
        this.autoRespond(this);
    }
};
MockXhr.prototype.abort = function() {
    this.aborted = true;
};
MockXhr.prototype.respond = function(status, body, headers, responseURL) {
    this.status = status;
    this.responseText = typeof body === 'string' ? body : JSON.stringify(body);
    this.responseHeaders = headers || {'Content-Type': 'application/json'};
    this.responseURL = responseURL || this.url;
    this.readyState = 4;
    this.onload();
};
MockXhr.prototype.json = function() {
    return JSON.parse(this.sentBody);
};

function chatResponse(message, finishReason) {
    return {choices: [{index: 0, message: Object.assign({role: 'assistant', content: null}, message), finish_reason: finishReason || 'stop'}]};
}

function toolCallResponse(name, args, id) {
    return chatResponse({
        content: '',
        tool_calls: [{id: id || 'call_1', type: 'function', 'function': {name: name, arguments: typeof args === 'string' ? args : JSON.stringify(args)}}]
    }, 'tool_calls');
}

// ---- test registry ----
const tests = [];
function test(name, fn) {
    tests.push({name: name, fn: fn, file: currentFile});
}
let currentFile = '';

let env = null;
function setup() {
    const clock = new FakeClock();
    const pebble = new FakePebble();
    const storage = new MemoryStorage();
    const logs = [];
    const saved = {
        setTimeout: global.setTimeout,
        clearTimeout: global.clearTimeout,
        log: console.log,
        error: console.error,
        Pebble: global.Pebble,
        localStorage: global.localStorage,
        navigator: global.navigator
    };
    global.setTimeout = clock.setTimeout.bind(clock);
    global.clearTimeout = clock.clearTimeout.bind(clock);
    global.Pebble = pebble;
    global.localStorage = storage;
    console.log = function() {
        logs.push(Array.prototype.join.call(arguments, ' '));
    };
    console.error = console.log;
    env = {clock: clock, pebble: pebble, storage: storage, logs: logs, saved: saved};
    pkjs('agent/clock').now = function() {
        return Date.now();
    };
    return env;
}
function teardown() {
    const saved = env.saved;
    global.Date = RealDate;
    global.setTimeout = saved.setTimeout;
    global.clearTimeout = saved.clearTimeout;
    global.Pebble = saved.Pebble;
    global.localStorage = saved.localStorage;
    console.log = saved.log;
    console.error = saved.error;
    env = null;
}

const RealDate = Date;

// Pins "now" everywhere: Date.now(), new Date() and the agent clock. Restored after each test.
function setNow(ms) {
    function FakeDate() {
        if (!(this instanceof FakeDate)) {
            return new RealDate(ms).toString();
        }
        if (arguments.length === 0) {
            return new RealDate(ms);
        }
        return new (Function.prototype.bind.apply(RealDate, [null].concat(Array.prototype.slice.call(arguments))))();
    }
    FakeDate.prototype = RealDate.prototype;
    FakeDate.now = function() {
        return ms;
    };
    FakeDate.UTC = RealDate.UTC;
    FakeDate.parse = RealDate.parse;
    global.Date = FakeDate;
    pkjs('agent/clock').now = function() {
        return ms;
    };
}

// LLM client double: replays parsed responses (or Errors) and records every request.
function ScriptedClient(responses) {
    this.responses = responses.slice();
    this.requests = [];
}
ScriptedClient.prototype.complete = function(request, callback) {
    this.requests.push(JSON.parse(JSON.stringify(request)));
    let next = this.responses.shift();
    if (typeof next === 'function') {
        next = next(request);
    }
    if (next === undefined) {
        throw new Error('ScriptedClient ran out of responses');
    }
    if (next instanceof Error) {
        callback(next);
    } else {
        callback(null, next);
    }
};

function parsed(raw) {
    return pkjs('agent/llm_client').parseResponse(raw);
}

// Temporarily replaces a global (some, like navigator, are getters in recent Node versions).
function withGlobal(name, value, fn) {
    const original = Object.getOwnPropertyDescriptor(global, name);
    Object.defineProperty(global, name, {value: value, configurable: true, writable: true});
    try {
        return fn();
    } finally {
        if (original) {
            Object.defineProperty(global, name, original);
        } else {
            delete global[name];
        }
    }
}

function settings(values) {
    env.storage.setItem('clay-settings', JSON.stringify(values));
}

function run(files) {
    let failed = 0;
    files.forEach((file) => {
        currentFile = path.basename(file);
        require(file);
    });
    tests.forEach((t) => {
        setup();
        let error = null;
        try {
            t.fn(env);
        } catch (e) {
            error = e;
        }
        const logs = env.logs;
        teardown();
        if (error) {
            failed++;
            console.log('FAIL ' + t.file + ' > ' + t.name);
            console.log(String(error && error.stack || error).split('\n').map((l) => '    ' + l).join('\n'));
            if (logs.length) {
                console.log('    captured log:\n' + logs.map((l) => '      ' + l).join('\n'));
            }
        } else {
            console.log('ok   ' + t.file + ' > ' + t.name);
        }
    });
    console.log('\n' + (tests.length - failed) + '/' + tests.length + ' tests passed');
    return failed === 0;
}

module.exports = {
    test: test,
    run: run,
    pkjs: pkjs,
    MockXhr: MockXhr,
    chatResponse: chatResponse,
    toolCallResponse: toolCallResponse,
    settings: settings,
    setNow: setNow,
    withGlobal: withGlobal,
    ScriptedClient: ScriptedClient,
    parsed: parsed,
    messageKeys: messageKeys
};
