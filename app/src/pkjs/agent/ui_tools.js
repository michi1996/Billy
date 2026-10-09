/**
 * Copyright 2025 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 */

var messageKeys = require('message_keys');

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

function arraySchema(description) {
    return {
        type: 'array',
        description: description,
        items: {type: 'string'}
    };
}

exports.getDeclarations = function() {
    var optionMax = exports.getPickerOptionMaxChars();
    return [{
        type: 'function',
        'function': {
            name: 'ask_clarifying_question',
            description: 'Ask the user one short question with 2-4 options shown as a picker on the watch, when guessing would risk doing the wrong thing. Each option must be ' + optionMax + ' characters or fewer.',
            parameters: schema({
                question: stringSchema('Short watch-sized question.'),
                options: arraySchema('Two to four short answer options, each ' + optionMax + ' characters or fewer.'),
                context: stringSchema('The original request, so it can be continued after the user chooses.')
            }, ['question', 'options'])
        }
    }];
};

exports.execute = function(session, args, callback) {
    exports.sendClarification(session, {
        question: args.question,
        context: args.context,
        options: args.options
    });
    callback({
        stop_for_user: true,
        summary: 'Asked the user a clarifying question.'
    });
};

exports.sendClarification = function(session, card) {
    card = card || {};
    var options = Array.isArray(card.options) ? card.options.slice(0, 4) : [];
    options = options.filter(function(option) {
        return String(option || '').trim().length > 0;
    }).map(function(option) {
        return shortPickerLabel(option, exports.getPickerOptionMaxChars());
    });
    if (options.length < 2) {
        options = ['Yes', 'No'];
    }
    var message = {
        CLARIFY_WIDGET: 1,
        CLARIFY_QUESTION: String(card.question || 'Which option?').substring(0, 120),
        CLARIFY_CONTEXT: String(card.context || session.prompt || '').substring(0, 180),
        CLARIFY_OPTION_COUNT: options.length
    };
    for (var i = 0; i < options.length; i++) {
        message[messageKeys.CLARIFY_OPTION_0 + i] = String(options[i]).substring(0, 64);
    }
    session.enqueue(message);
    session.enqueue({CHAT_DONE: true});
};

exports.getPickerOptionMaxChars = function() {
    var platform = '';
    try {
        platform = Pebble && Pebble.platform ? Pebble.platform : '';
    } catch (e) {
        platform = '';
    }
    if (platform === 'emery') {
        return 28;
    }
    if (platform === 'basalt') {
        return 20;
    }
    return 18;
};

function shortPickerLabel(option, maxChars) {
    var label = String(option || '').split('|')[0].trim();
    maxChars = Math.max(8, Math.min(64, maxChars || 18));
    if (label.length <= maxChars) {
        return label;
    }
    return label.substring(0, Math.max(0, maxChars - 3)).replace(/\s+$/, '') + '...';
}
