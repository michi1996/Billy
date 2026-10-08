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

exports.DEFAULT_LLM_MODEL = 'qwen2.5-14b-instruct';
exports.DEFAULT_LLM_TIMEOUT_SECONDS = 45;
exports.MIN_LLM_TIMEOUT_SECONDS = 10;
exports.MAX_LLM_TIMEOUT_SECONDS = 90;

exports.getSettings = function() {
    try {
        return JSON.parse(localStorage.getItem('clay-settings')) || {};
    } catch (e) {
        console.log('Stored settings are not valid JSON; ignoring them.');
        return {};
    }
}

exports.getSetting = function(key, defaultValue) {
    var settings = exports.getSettings();
    if (settings[key] !== undefined) {
        return settings[key];
    }
    return defaultValue;
}

exports.setSetting = function(key, value) {
    var settings = exports.getSettings();
    settings[key] = value;
    localStorage.setItem('clay-settings', JSON.stringify(settings));
}

exports.isLocationEnabled = function() {
    return !!exports.getSettings()['LOCATION_ENABLED'];
}

function compact(value) {
    if (value === undefined || value === null) {
        return '';
    }
    return String(value).replace(/\s+/g, '');
}

function readBoolean(key, defaultValue) {
    var value = exports.getSetting(key, defaultValue);
    if (value === false || value === 0 || value === '0' || value === 'false') {
        return false;
    }
    if (value === true || value === 1 || value === '1' || value === 'true') {
        return true;
    }
    return defaultValue;
}

// Accepts what people tend to paste: a bare host, a trailing slash, or the full
// /v1/chat/completions endpoint. Returns '' if the value is not an http(s) URL.
exports.normalizeBaseUrl = function(value) {
    var url = compact(value);
    if (!url) {
        return '';
    }
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
        url = 'https://' + url;
    }
    if (!/^https?:\/\/[^\/?#]+/i.test(url)) {
        return '';
    }
    url = url.replace(/[?#].*$/, '');
    url = url.replace(/\/+$/, '');
    url = url.replace(/\/v1(\/chat\/completions)?$/i, '');
    url = url.replace(/\/+$/, '');
    return url;
}

exports.getLlmBaseUrl = function() {
    return exports.normalizeBaseUrl(exports.getSetting('LLM_BASE_URL', ''));
}

exports.getCfAccessClientId = function() {
    return compact(exports.getSetting('CF_ACCESS_CLIENT_ID', ''));
}

exports.getCfAccessClientSecret = function() {
    return compact(exports.getSetting('CF_ACCESS_CLIENT_SECRET', ''));
}

exports.getLlmModel = function() {
    var model = compact(exports.getSetting('LLM_MODEL', ''));
    return model || exports.DEFAULT_LLM_MODEL;
}

exports.getLlmTimeoutSeconds = function() {
    var seconds = parseInt(exports.getSetting('LLM_TIMEOUT_SECONDS', exports.DEFAULT_LLM_TIMEOUT_SECONDS), 10);
    if (isNaN(seconds)) {
        return exports.DEFAULT_LLM_TIMEOUT_SECONDS;
    }
    return Math.max(exports.MIN_LLM_TIMEOUT_SECONDS, Math.min(exports.MAX_LLM_TIMEOUT_SECONDS, seconds));
}

exports.getLlmSettings = function() {
    return {
        baseUrl: exports.getLlmBaseUrl(),
        clientId: exports.getCfAccessClientId(),
        clientSecret: exports.getCfAccessClientSecret(),
        model: exports.getLlmModel(),
        timeoutSeconds: exports.getLlmTimeoutSeconds()
    };
}

exports.isLlmConfigured = function() {
    var settings = exports.getLlmSettings();
    return !!(settings.baseUrl && settings.clientId && settings.clientSecret);
}

exports.isFastPathEnabled = function() {
    return readBoolean('FAST_PATH_ENABLED', true);
}

// Show the answer on the watch while the model is still writing it.
exports.isStreamingEnabled = function() {
    return readBoolean('STREAM_ANSWERS', true);
};

exports.isEmulatorRealServerEnabled = function() {
    return readBoolean('EMULATOR_REAL_SERVER', false);
}
