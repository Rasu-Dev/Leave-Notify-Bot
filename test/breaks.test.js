'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Isolate notifier state from the real data dir (must be set before requiring notifier).
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'leave-bot-test-'));

const { findLongBreaks } = require('../src/breaks');
const { formatOutbound, formatReturn, formatTatkal, dueNotifications } = require('../src/notifier');

const calendar = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'data', 'holidays-2026.json'), 'utf8')
);
// Ignore temporary DUMMY entries added to the live data for manual testing.
calendar.holidays = calendar.holidays.filter((h) => !h.name.includes('DUMMY'));

test('finds exactly the seven 3-day breaks in 2026', () => {
  const spans = findLongBreaks(calendar, 3).map((b) => `${b.start}..${b.end}`);
  assert.deepEqual(spans, [
    '2026-03-20..2026-03-22',
    '2026-04-03..2026-04-05',
    '2026-05-01..2026-05-03',
    '2026-08-14..2026-08-16',
    '2026-10-02..2026-10-04',
    '2026-11-07..2026-11-09',
    '2026-12-25..2026-12-27',
  ]);
});

test('minDays=2 adds the six 2-day clusters', () => {
  const spans = findLongBreaks(calendar, 2).map((b) => `${b.start}..${b.end}`);
  assert.deepEqual(spans, [
    '2026-01-14..2026-01-15', // Pongal + First Saturday (Moved)
    '2026-01-25..2026-01-26', // Sunday + Republic Day
    '2026-02-14..2026-02-15', // First Saturday (Moved) + Sunday
    '2026-03-20..2026-03-22',
    '2026-04-03..2026-04-05',
    '2026-05-01..2026-05-03',
    '2026-06-06..2026-06-07', // First Saturday + Sunday
    '2026-07-04..2026-07-05', // First Saturday + Sunday
    '2026-08-14..2026-08-16',
    '2026-09-05..2026-09-06', // First Saturday + Sunday
    '2026-10-02..2026-10-04',
    '2026-11-07..2026-11-09',
    '2026-12-25..2026-12-27',
  ]);
});

test('single off-days are never announced', () => {
  const starts = findLongBreaks(calendar, 2).map((b) => b.start);
  assert.ok(!starts.includes('2026-01-01')); // New Year, lone Thursday
  assert.ok(!starts.includes('2026-05-27')); // Bakrid, lone Wednesday
});

test('breaks carry human-readable reasons', () => {
  const oct = findLongBreaks(calendar, 2).find((b) => b.start === '2026-10-02');
  assert.deepEqual(oct.reasons, ['Gandhi Jayanthi', 'First Saturday', 'Sunday']);
});

test('message: tomorrow is ticket opening', () => {
  const brk = findLongBreaks(calendar, 2).find((b) => b.start === '2026-10-02');
  const msg = formatOutbound(brk);
  assert.match(msg, /Tomorrow is ticket opening/);
  assert.match(msg, /\*Gandhi Jayanthi\* break — 3 days leave/);
  assert.match(msg, /Fri 02 Oct 2026 – Sun 04 Oct 2026/);
  assert.match(msg, /opens \*tomorrow\* on IRCTC/);
});

test('message: 2-day leave wording', () => {
  const brk = findLongBreaks(calendar, 2).find((b) => b.start === '2026-09-05');
  const msg = formatOutbound(brk);
  assert.match(msg, /\*First Saturday\* break — 2 days leave/);
});

test('message: return ticket opens tomorrow', () => {
  const brk = findLongBreaks(calendar, 2).find((b) => b.start === '2026-10-02');
  const msg = formatReturn(brk);
  assert.match(msg, /Return ticket opens tomorrow/);
  assert.match(msg, /Returning on Sun 04 Oct\?/);
});

test('message: tatkal two days before the break', () => {
  const brk = findLongBreaks(calendar, 2).find((b) => b.start === '2026-10-02');
  const msg = formatTatkal(brk);
  assert.match(msg, /Tatkal alert/);
  assert.match(msg, /Leaving tomorrow \(Thu 01 Oct\) night\?/);
  assert.match(msg, /opens \*TODAY at 11 AM\*/);
  assert.match(msg, /Tatkal for Fri 02 Oct trains opens tomorrow at 11 AM/);
});

test('break title prefers the festival name over First Saturday and drops "(Moved)"', () => {
  const nov = findLongBreaks(calendar, 2).find((b) => b.start === '2026-11-07');
  assert.match(formatOutbound(nov), /\*Deepavali\* break — 3 days leave/);
  const jan = findLongBreaks(calendar, 2).find((b) => b.start === '2026-01-14');
  assert.match(formatOutbound(jan), /\*Pongal\* break — 2 days leave/);
});

function withFakeToday(dateStr, fn) {
  process.env.FAKE_TODAY = dateStr;
  try {
    return fn();
  } finally {
    delete process.env.FAKE_TODAY;
  }
}

// dueNotifications reads FAKE_TODAY synchronously on entry, so setting it just
// for the call is enough even though the function itself is async.
function dueOn(dateStr) {
  return withFakeToday(dateStr, () => dueNotifications());
}

test('timing: Aug 2 sends the outbound "tomorrow" alert for the Oct 2 break', async () => {
  const due = await dueOn('2026-08-02');
  const oct = due.find((d) => d.key === 'out:2026-10-02');
  assert.ok(oct, 'Oct 2 outbound alert should be due');
  assert.match(oct.message, /Tomorrow is ticket opening/);
  // Breaks whose booking window is still far away must not fire yet.
  assert.ok(!due.some((d) => d.key === 'out:2026-11-07'));
  assert.ok(!due.some((d) => d.key === 'out:2026-12-25'));
});

test('timing: Aug 4 sends the return alert for the Oct 4 return journey', async () => {
  const due = await dueOn('2026-08-04');
  const ret = due.find((d) => d.key === 'ret:2026-10-04');
  assert.ok(ret, 'Oct 4 return alert should be due');
  assert.match(ret.message, /Return ticket opens tomorrow/);
});

test('timing: Sep 30 sends the tatkal alert for the Oct 2 break', async () => {
  const due = await dueOn('2026-09-30');
  const tat = due.find((d) => d.key === 'tat:2026-10-02');
  assert.ok(tat, 'tatkal alert should fire 2 days before the break');
  assert.match(tat.message, /Leaving tomorrow \(Thu 01 Oct\) night\?/);
  // Not earlier than 2 days before:
  assert.ok(!(await dueOn('2026-09-29')).some((d) => d.key === 'tat:2026-10-02'));
});

test('timing: missed alert days are skipped, never caught up', async () => {
  // Aug 2 was the outbound alert day for the Oct 2 break — a day later it must not fire.
  assert.ok(!(await dueOn('2026-08-03')).some((d) => d.key === 'out:2026-10-02'));
  // Sep 30 was the tatkal alert day — no day-before fallback.
  assert.ok(!(await dueOn('2026-10-01')).some((d) => d.key === 'tat:2026-10-02'));
});

test('warns when the alert horizon reaches a year with no holiday file', async () => {
  const warn = (await dueOn('2026-11-20')).find((d) => d.key === 'cal:2027:2026-11');
  assert.ok(warn, '2027-missing warning should be due in late Nov 2026');
  assert.match(warn.message, /Holiday list for 2027 is not updated/);
  assert.equal(warn.brk, null);
  // Horizon (early Nov) is still within 2026 — no warning yet.
  assert.ok(!(await dueOn('2026-08-20')).some((d) => d.key.startsWith('cal:')));
});

test('every due message ends with the automated-message footer', async () => {
  const due = await dueOn('2026-09-30');
  assert.ok(due.length > 0);
  for (const d of due) {
    assert.match(d.message, /_note: this is an automated message_$/);
  }
});

test('timing: breaks already started are skipped', async () => {
  // Sep 5–6 break started yesterday — outbound/tatkal are pointless now.
  const due = await dueOn('2026-09-06');
  assert.ok(!due.some((d) => d.key === 'out:2026-09-05'));
  assert.ok(!due.some((d) => d.key === 'tat:2026-09-05'));
});
