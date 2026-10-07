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

var actions = require('../actions');

function schema(properties, required) {
    return {
        type: 'object',
        properties: properties,
        required: required || []
    };
}

function stringSchema(description) {
    return {
        type: 'string',
        description: description
    };
}

function integerSchema(description) {
    return {
        type: 'integer',
        description: description
    };
}

function booleanSchema(description) {
    return {
        type: 'boolean',
        description: description
    };
}

function declare(name, description, parameters) {
    return {
        type: 'function',
        'function': {
            name: name,
            description: description,
            parameters: parameters
        }
    };
}

var ISO_EXAMPLE = "ISO 8601 with the local UTC offset, e.g. '2026-10-08T07:00:00+02:00'";

exports.getDeclarations = function() {
    return [
        declare('set_alarm', 'Set an alarm on the watch for a clock time.', schema({
            time: stringSchema('Alarm time, ' + ISO_EXAMPLE + '. Must be in the future.'),
            name: stringSchema('Only if the user explicitly named the alarm, in title case. Otherwise omit.')
        }, ['time'])),
        declare('get_alarms', 'List the alarms set on the watch.', schema({}, [])),
        declare('delete_alarm', 'Delete one alarm. Call get_alarms first and pass the exact time it returned.', schema({
            time: stringSchema('Time of the alarm to delete, ' + ISO_EXAMPLE + '.')
        }, ['time'])),
        declare('set_timer', 'Start a countdown timer on the watch.', schema({
            duration_seconds: integerSchema('Timer length in seconds, e.g. 300 for 5 minutes. Between 1 and 604800.'),
            name: stringSchema('Only if the user explicitly named the timer, in title case. Otherwise omit.')
        }, ['duration_seconds'])),
        declare('get_timers', 'List the running timers on the watch.', schema({}, [])),
        declare('delete_timer', 'Delete one timer. Call get_timers first and pass the exact expirationTimeForDeletingAndWidgets it returned.', schema({
            time: stringSchema('Expiration time of the timer to delete, ISO 8601.')
        }, ['time'])),
        declare('set_reminder', 'Create a timeline reminder. Give exactly one of time or delay_mins. If the user gives a time but no day, use the next time that clock time occurs.', schema({
            time: stringSchema('Reminder time, ' + ISO_EXAMPLE + '.'),
            delay_mins: integerSchema('Minutes from now, for requests like "in 20 minutes".'),
            what: stringSchema('What to remind the user about, short.')
        }, ['what'])),
        declare('get_reminders', 'List the active reminders.', schema({}, [])),
        declare('delete_reminder', 'Delete a reminder by id. Call get_reminders first to find the id.', schema({
            id: stringSchema('The id returned by get_reminders.')
        }, ['id'])),
        declare('update_settings', 'Change watch settings. Pass only the settings the user asked to change.', schema({
            unitSystem: stringSchema("One of 'imperial', 'metric', 'uk hybrid', 'both', 'auto'."),
            responseLanguage: stringSchema("A language code such as 'en_US', 'de_DE', 'fr_FR', or 'auto'."),
            alarmVibrationPattern: stringSchema("One of 'Reveille', 'Mario', 'Nudge Nudge', 'Jackhammer', 'Standard'."),
            timerVibrationPattern: stringSchema("One of 'Reveille', 'Mario', 'Nudge Nudge', 'Jackhammer', 'Standard'."),
            quickLaunchBehaviour: stringSchema("One of 'start conversation and time out', 'start conversation and stay open', 'open home screen'."),
            confirmPrompts: booleanSchema('True to confirm dictated prompts before responding, false to respond immediately.')
        }, []))
    ];
};

function callAction(session, action, callback) {
    var ws = {
        send: function(resultString) {
            try {
                callback(JSON.parse(resultString));
            } catch (e) {
                callback({error: e.message});
            }
        }
    };
    actions.handleAction(session, ws, JSON.stringify(action));
}

function executeSetReminder(session, args, callback) {
    session.handleMessage({data: 'fSetting a reminder'});
    var time = args.time;
    if (args.delay_mins) {
        time = new Date(Date.now() + parseInt(args.delay_mins, 10) * 60000).toISOString();
    }
    callAction(session, {
        action: 'set_reminder',
        what: args.what,
        time: time
    }, callback);
}

exports.execute = function(session, name, args, callback) {
    switch (name) {
    case 'set_alarm':
        session.handleMessage({data: 'fSetting an alarm'});
        callAction(session, {action: 'set_alarm', isTimer: false, time: args.time, name: args.name, cancel: false}, callback);
        return true;
    case 'get_alarms':
        session.handleMessage({data: 'fChecking your alarms'});
        callAction(session, {action: 'get_alarm', isTimer: false}, callback);
        return true;
    case 'delete_alarm':
        session.handleMessage({data: 'fDeleting an alarm'});
        callAction(session, {action: 'set_alarm', isTimer: false, time: args.time, cancel: true}, callback);
        return true;
    case 'set_timer':
        session.handleMessage({data: 'fSetting a timer'});
        callAction(session, {action: 'set_alarm', isTimer: true, duration: args.duration_seconds, name: args.name, cancel: false}, callback);
        return true;
    case 'get_timers':
        session.handleMessage({data: 'fChecking your timers'});
        callAction(session, {action: 'get_alarm', isTimer: true}, callback);
        return true;
    case 'delete_timer':
        session.handleMessage({data: 'fDeleting a timer'});
        callAction(session, {action: 'set_alarm', isTimer: true, time: args.time, cancel: true}, callback);
        return true;
    case 'set_reminder':
        executeSetReminder(session, args, callback);
        return true;
    case 'get_reminders':
        session.handleMessage({data: 'fChecking your reminders'});
        callAction(session, {action: 'get_reminders'}, callback);
        return true;
    case 'delete_reminder':
        session.handleMessage({data: 'fDeleting a reminder'});
        callAction(session, {action: 'delete_reminder', id: args.id}, callback);
        return true;
    case 'update_settings':
        session.handleMessage({data: 'fUpdating settings'});
        var action = {action: 'update_settings'};
        for (var key in args) {
            if (args.hasOwnProperty(key)) {
                action[key] = args[key];
            }
        }
        callAction(session, action, callback);
        return true;
    default:
        return false;
    }
};
