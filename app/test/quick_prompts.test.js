'use strict';

const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const h = require('./harness');
const FakeWatch = require('./fake_watch');

function qp() {
    return h.pkjs('quick_prompts');
}

h.test('an explicit language wins', () => {
    assert.strictEqual(qp().resolveLanguage({QUICK_PROMPTS: 'de', LANGUAGE_CODE: 'fr_FR'}, 'it-CH'), 'de');
    assert.strictEqual(qp().resolveLanguage({QUICK_PROMPTS: 'it'}, 'en-US'), 'it');
});

h.test('automatic follows the response language, then the phone, then English', () => {
    assert.strictEqual(qp().resolveLanguage({QUICK_PROMPTS: 'auto', LANGUAGE_CODE: 'fr_FR'}, 'de-CH'), 'fr');
    assert.strictEqual(qp().resolveLanguage({QUICK_PROMPTS: 'auto', LANGUAGE_CODE: ''}, 'de-CH'), 'de');
    assert.strictEqual(qp().resolveLanguage({}, 'it-IT'), 'it');
    assert.strictEqual(qp().resolveLanguage({LANGUAGE_CODE: 'es_ES'}, 'es-ES'), 'en');
    assert.strictEqual(qp().resolveLanguage({}, ''), 'en');
});

h.test('custom prompts are used only when there are some', () => {
    const settings = {QUICK_PROMPTS: 'custom', CUSTOM_PROMPT_1: ' Wie ist das Wetter? ', CUSTOM_PROMPT_3: 'Timer 5 Minuten'};
    assert.deepStrictEqual(qp().buildMessage(settings, 'de-CH'), {
        QUICK_PROMPTS_LANG: 'custom',
        QUICK_PROMPTS_CUSTOM: 'Wie ist das Wetter?\nTimer 5 Minuten'
    });
    assert.deepStrictEqual(qp().buildMessage({QUICK_PROMPTS: 'custom', CUSTOM_PROMPT_2: '   '}, 'de-CH'), {
        QUICK_PROMPTS_LANG: 'de',
        QUICK_PROMPTS_CUSTOM: ''
    });
});

h.test('custom prompts fit into the 250 bytes the watch can store', () => {
    const settings = {QUICK_PROMPTS: 'custom'};
    qp().CUSTOM_KEYS.forEach((key, i) => {
        settings[key] = 'Prompt ' + (i + 1) + ' über Größe und Übergänge ' + 'x'.repeat(40);
    });
    const text = qp().customText(settings);
    assert.ok(Buffer.byteLength(text, 'utf8') <= 250, Buffer.byteLength(text, 'utf8'));
    const lines = text.split('\n');
    assert.ok(lines.length >= 3 && lines.length < 6, lines.length);
    lines.forEach((line) => assert.ok(line.length <= 60));
    assert.ok(lines[0].indexOf('Prompt 1 ') === 0);
});

h.test('saving the settings sends the quick prompt choice, not the raw fields', (env) => {
    const page = h.pkjs('settings_page');
    const message = page.buildWatchMessage({
        QUICK_PROMPTS: 'custom',
        CUSTOM_PROMPT_1: 'Set a timer for 5 minutes',
        QUICK_LAUNCH_BEHAVIOUR: '1'
    });
    assert.deepStrictEqual(message, {
        QUICK_LAUNCH_BEHAVIOUR: '1',
        QUICK_PROMPTS_LANG: 'custom',
        QUICK_PROMPTS_CUSTOM: 'Set a timer for 5 minutes'
    });
    Object.keys(message).forEach((key) => assert.ok(key in h.messageKeys, key + ' is not a message key'));
    ['QUICK_PROMPTS'].concat(qp().CUSTOM_KEYS).forEach((key) => {
        assert.ok(!(key in h.messageKeys), key + ' must not be a message key');
    });
});

h.test('changing the response language by voice updates automatic quick prompts', (env) => {
    const now = Date.UTC(2026, 9, 7, 19, 46);
    h.setNow(now);
    h.settings({QUICK_PROMPTS: 'auto', LANGUAGE_CODE: 'en_US'});
    const watch = new FakeWatch(env, now / 1000);
    const Session = h.pkjs('session').Session;
    const session = new Session('Antworte auf Deutsch', 'thread-q');
    let result;
    h.pkjs('agent/tools').execute(session, {id: 'c', name: 'update_settings', arguments: {responseLanguage: 'de_DE'}, argumentsError: null}, (r) => {
        result = r;
    });
    watch.flush();
    assert.deepStrictEqual(result, {status: 'ok'});
    const sent = env.pebble.sent.filter((m) => 'QUICK_PROMPTS_LANG' in m);
    assert.deepStrictEqual(sent, [{QUICK_PROMPTS_LANG: 'de', QUICK_PROMPTS_CUSTOM: ''}]);
});

h.test('other setting changes do not resend quick prompts', (env) => {
    const now = Date.UTC(2026, 9, 7, 19, 46);
    h.setNow(now);
    const watch = new FakeWatch(env, now / 1000);
    const Session = h.pkjs('session').Session;
    h.pkjs('agent/tools').execute(new Session('metric', 't'), {id: 'c', name: 'update_settings', arguments: {unitSystem: 'metric'}, argumentsError: null}, () => {});
    watch.flush();
    assert.strictEqual(env.pebble.sent.filter((m) => 'QUICK_PROMPTS_LANG' in m).length, 0);
});

h.test('every language has a built-in list registered as a resource', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    qp().LANGUAGES.forEach((language) => {
        const file = 'text/quick_prompts/' + language + '.txt';
        const resource = pkg.pebble.resources.media.find((r) => r.file === file);
        assert.ok(resource, file + ' is not in package.json');
        assert.strictEqual(resource.name, 'QUICK_PROMPTS_' + language.toUpperCase());
        const lines = fs.readFileSync(path.join(__dirname, '..', 'resources', file), 'utf8').replace(/\n$/, '').split('\n');
        assert.ok(lines.length >= 5 && lines.length <= 12, file + ': ' + lines.length + ' lines');
        lines.forEach((line) => {
            assert.ok(line.trim().length > 0, file + ' has an empty line');
            assert.ok(line.length <= 60, file + ': line too long: ' + line);
        });
    });
});

h.test('config page offers every language plus automatic and custom', () => {
    const config = require('../src/pkjs/config.json');
    const items = [].concat.apply([], config.filter((s) => s.items).map((s) => s.items));
    const select = items.find((i) => i.messageKey === 'QUICK_PROMPTS');
    assert.deepStrictEqual(select.options.map((o) => o.value), ['auto'].concat(qp().LANGUAGES).concat(['custom']));
    qp().CUSTOM_KEYS.forEach((key) => assert.ok(items.find((i) => i.messageKey === key), key + ' missing'));
});
