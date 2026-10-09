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

// Decides which quick prompt list the watch shows for the up button: one of the built-in lists
// (resources/text/quick_prompts/*.txt) or the user's own prompts from the settings page.

exports.LANGUAGES = ['en', 'de', 'fr', 'it'];
exports.CUSTOM_KEYS = ['CUSTOM_PROMPT_1', 'CUSTOM_PROMPT_2', 'CUSTOM_PROMPT_3',
    'CUSTOM_PROMPT_4', 'CUSTOM_PROMPT_5', 'CUSTOM_PROMPT_6'];
// The watch stores them in one persist string (256 bytes including the terminator).
exports.MAX_CUSTOM_BYTES = 250;
var MAX_PROMPT_CHARS = 60;

function languageOf(code) {
    var language = String(code || '').toLowerCase().substring(0, 2);
    return exports.LANGUAGES.indexOf(language) !== -1 ? language : '';
}

function phoneLanguage() {
    try {
        return navigator && navigator.language ? navigator.language : '';
    } catch (e) {
        return '';
    }
}

function utf8Length(text) {
    return unescape(encodeURIComponent(text)).length;
}

exports.customPrompts = function(settings) {
    var prompts = [];
    exports.CUSTOM_KEYS.forEach(function(key) {
        var prompt = String(settings[key] || '').replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
        if (prompt) {
            prompts.push(prompt.substring(0, MAX_PROMPT_CHARS));
        }
    });
    return prompts;
};

// Joins the prompts with newlines, dropping those that would not fit on the watch.
exports.customText = function(settings) {
    var text = '';
    exports.customPrompts(settings).forEach(function(prompt) {
        var candidate = text ? text + '\n' + prompt : prompt;
        if (utf8Length(candidate) <= exports.MAX_CUSTOM_BYTES) {
            text = candidate;
        }
    });
    return text;
};

// "en", "de", "fr", "it" or "custom". Automatic follows the response language, then the phone's
// language, then English.
exports.resolveLanguage = function(settings, navigatorLanguage) {
    var choice = String(settings.QUICK_PROMPTS || 'auto');
    if (choice === 'custom' && exports.customText(settings)) {
        return 'custom';
    }
    if (languageOf(choice)) {
        return languageOf(choice);
    }
    return languageOf(settings.LANGUAGE_CODE) ||
        languageOf(navigatorLanguage === undefined ? phoneLanguage() : navigatorLanguage) ||
        'en';
};

exports.buildMessage = function(settings, navigatorLanguage) {
    var language = exports.resolveLanguage(settings, navigatorLanguage);
    return {
        QUICK_PROMPTS_LANG: language,
        QUICK_PROMPTS_CUSTOM: language === 'custom' ? exports.customText(settings) : ''
    };
};
