'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { findLongBreaks } = require('../src/breaks');
const { formatMessage } = require('../src/notifier');

const calendar = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'data', 'holidays-2026.json'), 'utf8')
);

test('finds exactly the seven 2026 long breaks', () => {
  const breaks = findLongBreaks(calendar);
  const spans = breaks.map((b) => `${b.start}..${b.end}`);
  assert.deepEqual(spans, [
    '2026-03-20..2026-03-22',
    '2026-04-03..2026-04-05',
    '2026-05-01..2026-05-03',
    '2026-08-14..2026-08-16',
    '2026-10-02..2026-10-04',
    '2026-11-07..2026-11-09',
    '2026-12-25..2026-12-27',
  ]);
  assert.ok(breaks.every((b) => b.days === 3));
});

test('two-day clusters are excluded', () => {
  const starts = findLongBreaks(calendar).map((b) => b.start);
  // Pongal + moved First Saturday (Wed–Thu), Sunday + Republic Day (Sun–Mon)
  assert.ok(!starts.includes('2026-01-14'));
  assert.ok(!starts.includes('2026-01-25'));
  // Plain First Saturday + Sunday weekends
  assert.ok(!starts.includes('2026-06-06'));
  assert.ok(!starts.includes('2026-09-05'));
});

test('breaks carry human-readable reasons', () => {
  const oct = findLongBreaks(calendar).find((b) => b.start === '2026-10-02');
  assert.deepEqual(oct.reasons, ['Gandhi Jayanthi', 'First Saturday', 'Sunday']);
});

test('minDays is respected', () => {
  assert.equal(findLongBreaks(calendar, 4).length, 0);
  // With minDays=2 the ordinary First-Saturday weekends appear too.
  assert.ok(findLongBreaks(calendar, 2).length > 7);
});

test('message format', () => {
  const brk = findLongBreaks(calendar).find((b) => b.start === '2026-11-07');
  const msg = formatMessage(brk, 60);
  assert.match(msg, /Long break alert/);
  assert.match(msg, /Sat 07 Nov 2026 – Mon 09 Nov 2026/);
  assert.match(msg, /3 days off/);
  assert.match(msg, /Deepavali/);
  assert.match(msg, /Starts in 60 days/);
});
