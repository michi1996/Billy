'use strict';

// PebbleKit JS runs on old JavaScript engines. Guard against ES2015+ syntax and APIs sneaking in.
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const h = require('./harness');

const PKJS = path.join(__dirname, '..', 'src', 'pkjs');

function listJs(dir) {
    return fs.readdirSync(dir, {withFileTypes: true}).reduce((files, entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            return files.concat(listJs(full));
        }
        return /\.js$/.test(entry.name) ? files.concat(full) : files;
    }, []);
}

// Removes comments, string literals and regex literals so the checks only see code.
function codeOnly(source) {
    let out = '';
    let i = 0;
    let lastSignificant = '';
    while (i < source.length) {
        const c = source[i];
        const next = source[i + 1];
        if (c === '/' && next === '/') {
            while (i < source.length && source[i] !== '\n') i++;
            continue;
        }
        if (c === '/' && next === '*') {
            i = source.indexOf('*/', i + 2) + 2;
            continue;
        }
        if (c === '"' || c === "'" || c === '`') {
            if (c === '`') {
                out += '`';
            }
            i++;
            while (i < source.length && source[i] !== c) {
                i += source[i] === '\\' ? 2 : 1;
            }
            i++;
            out += '""';
            lastSignificant = '"';
            continue;
        }
        if (c === '/' && /[(,=:[!&|?{};+\-*%<>~^]|^$/.test(lastSignificant)) {
            i++;
            let inClass = false;
            while (i < source.length && (source[i] !== '/' || inClass)) {
                if (source[i] === '\\') i++;
                else if (source[i] === '[') inClass = true;
                else if (source[i] === ']') inClass = false;
                i++;
            }
            i++;
            while (/[a-z]/.test(source[i] || '')) i++;
            out += '/r/';
            lastSignificant = '/';
            continue;
        }
        out += c;
        if (!/\s/.test(c)) {
            lastSignificant = c;
        }
        i++;
    }
    return out;
}

const forbidden = [
    [/\blet\s+[\w[{]/, 'let'],
    [/\bconst\s+[\w[{]/, 'const'],
    [/=>/, 'arrow function'],
    [/\basync\s+function\b|\bawait\s/, 'async/await'],
    [/\bfetch\s*\(/, 'fetch'],
    [/\bPromise\b/, 'Promise'],
    [/`/, 'template literal'],
    [/\bclass\s+\w+/, 'class'],
    [/\.\.\.\w/, 'spread'],
    [/\bObject\.assign\b|\bArray\.from\b|\.includes\(|\.find\(|\.startsWith\(|\.endsWith\(/, 'ES2015+ library call']
];

h.test('pkjs sources stay ES5', () => {
    const problems = [];
    listJs(PKJS).forEach((file) => {
        const code = codeOnly(fs.readFileSync(file, 'utf8'));
        code.split('\n').forEach((line, index) => {
            forbidden.forEach((rule) => {
                if (rule[0].test(line)) {
                    problems.push(path.relative(PKJS, file) + ':' + (index + 1) + ' uses ' + rule[1]);
                }
            });
        });
    });
    assert.deepStrictEqual(problems, []);
});
