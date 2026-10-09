// Entry point for `npm test`. Pins the timezone so date tests are deterministic, including the
// Europe/Zurich daylight saving switches.
'use strict';

process.env.TZ = 'Europe/Zurich';

const fs = require('fs');
const path = require('path');

// Sanity check that the timezone took effect (CET in January, CEST in July).
if (new Date(2026, 0, 15).getTimezoneOffset() !== -60 || new Date(2026, 6, 15).getTimezoneOffset() !== -120) {
    console.error('Could not switch the test process to Europe/Zurich. Run with TZ=Europe/Zurich.');
    process.exit(2);
}

const harness = require('./harness');
const filter = process.argv[2];
const files = fs.readdirSync(__dirname)
    .filter((name) => /\.test\.js$/.test(name))
    .filter((name) => !filter || name.indexOf(filter) !== -1)
    .sort()
    .map((name) => path.join(__dirname, name));

process.exit(harness.run(files) ? 0 : 1);
