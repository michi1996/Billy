// Answers the AppMessages that actions/alarms.js sends, the way src/c/alarms/manager.c does.
'use strict';

const h = require('./harness');

const S_SUCCESS = 0;
const E_INVALID_ARGUMENT = -4;
const E_OUT_OF_RESOURCES = -7;
const MAX_ALARMS = 8;

function FakeWatch(env, nowSeconds) {
    this.env = env;
    this.alarms = [];
    this.nowSeconds = nowSeconds;
    this.forcedResult = null;
    this.silent = false;
    this.pending = [];
    const watch = this;
    env.pebble.sendAppMessage = function(message, ok) {
        env.pebble.sent.push(message);
        if (ok) {
            ok();
        }
        watch.handle(message);
    };
}

// Replies are queued like real Bluetooth round trips; flush() delivers them (and any replies to
// messages sent while handling them).
FakeWatch.prototype.reply = function(payload) {
    this.pending.push(payload);
};

FakeWatch.prototype.flush = function() {
    let delivered = 0;
    while (this.pending.length > 0) {
        this.env.pebble.dispatch('appmessage', {payload: this.pending.shift()});
        if (++delivered > 1000) {
            throw new Error('FakeWatch.flush: endless message loop');
        }
    }
};

FakeWatch.prototype.handle = function(message) {
    if (this.silent) {
        return;
    }
    if ('SET_ALARM_TIME' in message) {
        let result = this.forcedResult;
        if (result === null) {
            if (this.alarms.length >= MAX_ALARMS) {
                result = E_OUT_OF_RESOURCES;
            } else {
                const isTimer = !!message.SET_ALARM_IS_TIMER;
                const time = isTimer ? this.nowSeconds + message.SET_ALARM_TIME : message.SET_ALARM_TIME;
                this.alarms.push({time: time, isTimer: isTimer, name: message.SET_ALARM_NAME || ''});
                result = S_SUCCESS;
            }
        }
        this.reply({SET_ALARM_RESULT: result});
    } else if ('CANCEL_ALARM_TIME' in message) {
        const index = this.alarms.findIndex((a) => a.time === message.CANCEL_ALARM_TIME && a.isTimer === !!message.CANCEL_ALARM_IS_TIMER);
        if (index === -1) {
            this.reply({SET_ALARM_RESULT: E_INVALID_ARGUMENT});
        } else {
            this.alarms.splice(index, 1);
            this.reply({SET_ALARM_RESULT: S_SUCCESS});
        }
    } else if ('GET_ALARM_OR_TIMER' in message) {
        const isTimer = !!message.GET_ALARM_OR_TIMER;
        const matching = this.alarms.filter((a) => a.isTimer === isTimer);
        const payload = {CURRENT_TIME: this.nowSeconds};
        payload[h.messageKeys.GET_ALARM_RESULT] = matching.length;
        matching.forEach((a, i) => {
            payload[h.messageKeys.GET_ALARM_RESULT + i + 1] = a.time;
            payload[h.messageKeys.GET_ALARM_NAME + i + 1] = a.name;
        });
        this.reply(payload);
    }
};

FakeWatch.prototype.messages = function(key) {
    return this.env.pebble.sent.filter((m) => key in m);
};

module.exports = FakeWatch;
