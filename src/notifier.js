'use strict';

const fs = require('fs');
const path = require('path');
const { findLongBreaks, daysBetween, weekdayOf } = require('./breaks');

const DATA_DIR = process.env.DATA_DIR || './data';
const NOTIFY_DAYS = Number(process.env.NOTIFY_DAYS || 60);
const STATE_FILE = path.join(DATA_DIR, 'state', 'notified.json');

function today() {
  if (process.env.FAKE_TODAY) return process.env.FAKE_TODAY;
  // Date in the configured timezone (TZ env), not UTC.
  return new Date().toLocaleDateString('en-CA', { timeZone: process.env.TZ || 'Asia/Kolkata' });
}

function loadCalendars() {
  const dir = path.join(__dirname, '..', 'data');
  return fs
    .readdirSync(dir)
    .filter((f) => /^holidays-\d{4}\.json$/.test(f))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { notified: [] };
  }
}

function saveState(state) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function shortDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1];
  return `${weekdayOf(dateStr).slice(0, 3)} ${String(d).padStart(2, '0')} ${month} ${y}`;
}

function formatMessage(brk, daysUntil) {
  const when = daysUntil === 0 ? 'Starts today' : daysUntil === 1 ? 'Starts tomorrow' : `Starts in ${daysUntil} days`;
  return [
    '🚂 *Long break alert!*',
    `*${shortDate(brk.start)} – ${shortDate(brk.end)}* — ${brk.days} days off`,
    `(${brk.reasons.join(' + ')})`,
    `${when} — book your train tickets now! 🎫`,
  ].join('\n');
}

/**
 * Find long breaks due for notification: starting within NOTIFY_DAYS from today
 * and not yet notified. Returns [{ break, daysUntil, message }].
 */
function dueNotifications() {
  const todayStr = today();
  const state = loadState();
  const due = [];
  for (const calendar of loadCalendars()) {
    for (const brk of findLongBreaks(calendar)) {
      const daysUntil = daysBetween(todayStr, brk.start);
      if (daysUntil >= 0 && daysUntil <= NOTIFY_DAYS && !state.notified.includes(brk.start)) {
        due.push({ brk, daysUntil, message: formatMessage(brk, daysUntil) });
      }
    }
  }
  return due;
}

function markNotified(brk) {
  const state = loadState();
  if (!state.notified.includes(brk.start)) {
    state.notified.push(brk.start);
    saveState(state);
  }
}

/**
 * Daily job: send every due notification via the given sender.
 * @param {(message: string) => Promise<void>} send
 * @param {{dryRun?: boolean}} opts
 */
async function runDailyCheck(send, opts = {}) {
  const due = dueNotifications();
  if (due.length === 0) {
    console.log(`[notifier] ${today()}: no notifications due`);
    return [];
  }
  for (const item of due) {
    if (opts.dryRun) {
      console.log(`[notifier] DRY RUN — would send:\n${item.message}\n`);
      continue;
    }
    await send(item.message);
    markNotified(item.brk);
    console.log(`[notifier] notified for break starting ${item.brk.start}`);
  }
  return due;
}

module.exports = { runDailyCheck, dueNotifications, formatMessage, today };
