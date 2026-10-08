'use strict';

// The settings page script runs inside Clay's page, not in PebbleKit JS, so it cannot require the
// pkjs modules. These checks keep its copies of shared values in sync and its source safe to embed.
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const h = require('./harness');

const PKJS = path.join(__dirname, '..', 'src', 'pkjs');
const source = fs.readFileSync(path.join(PKJS, 'custom_config.js'), 'utf8');
const config = require('../src/pkjs/config.json');

function constant(text, name) {
    const match = new RegExp('var ' + name + ' = ([^;]+);').exec(text);
    assert.ok(match, name + ' not found');
    return match[1];
}

function stringList(text) {
    return text.match(/'[^']*'/g).map((s) => s.slice(1, -1));
}

h.test('the page uses the same secret placeholder as the settings handler', () => {
    assert.strictEqual(constant(source, 'SECRET_PLACEHOLDER'), "'" + h.pkjs('settings_page').SECRET_PLACEHOLDER + "'");
    assert.deepStrictEqual(stringList(constant(source, 'SECRET_KEYS')), h.pkjs('settings_page').SECRET_KEYS);
});

h.test('the page counts quick prompt bytes like the watch message', () => {
    const qp = h.pkjs('quick_prompts');
    const qpSource = fs.readFileSync(path.join(PKJS, 'quick_prompts.js'), 'utf8');
    assert.deepStrictEqual(stringList(constant(source, 'CUSTOM_KEYS')), qp.CUSTOM_KEYS);
    assert.strictEqual(Number(constant(source, 'MAX_CUSTOM_BYTES')), qp.MAX_CUSTOM_BYTES);
    assert.strictEqual(constant(source, 'MAX_PROMPT_CHARS'), constant(qpSource, 'MAX_PROMPT_CHARS'));
});

h.test('every custom item type on the page is registered by the page script', () => {
    const standard = ['heading', 'text', 'section', 'input', 'select', 'slider', 'toggle', 'submit'];
    const types = [];
    (function collect(items) {
        items.forEach((item) => {
            if (types.indexOf(item.type) === -1) {
                types.push(item.type);
            }
            if (item.items) {
                collect(item.items);
            }
        });
    })(config);
    types.filter((type) => standard.indexOf(type) === -1).forEach((type) => {
        assert.ok(source.indexOf("name: '" + type + "'") !== -1, type + ' is not registered');
    });
    assert.strictEqual(config[0].type, 'buddy-header');
    assert.strictEqual(config[config.length - 1].type, 'submit');
});

h.test('the page script survives being pasted into the page', () => {
    // Clay inserts the source with String#replace (where these dollar patterns are special)
    // into an inline script element.
    assert.ok(!/\$[$&'`]/.test(source), 'dollar replacement pattern');
    assert.ok(source.toLowerCase().indexOf('</script') === -1, 'closing script tag');
    assert.ok(/^[\x00-\x7f]*$/.test(source), 'non-ASCII character');
});
