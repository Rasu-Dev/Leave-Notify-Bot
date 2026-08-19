'use strict';

const { findLongBreaks, daysBetween, addDays, weekdayOf } = require('./breaks');
const store = require('./store');
const { NOTIFY_DAYS, MIN_BREAK_DAYS, TZ } = require('./config');

const FOOTER = '\n\n_note: this is an automated message_';
// Warn this many days before the alert horizon reaches a year with no holiday file.
const CALENDAR_WARN_BUFFER = 15;

function today() {
  if (process.env.FAKE_TODAY) return process.env.FAKE_TODAY;
  // Date in the configured timezone, not UTC.
  return new Date().toLocaleDateString('en-CA', { timeZone: TZ });
}

function shortDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1];
  return `${weekdayOf(dateStr).slice(0, 3)} ${String(d).padStart(2, '0')} ${month} ${y}`;
}

// e.g. "Fri 02 Oct" — without the year, for mid-sentence use.
function shortDay(dateStr) {
  return shortDate(dateStr).replace(/ \d{4}$/, '');
}

// The holiday the break is known by: prefer a named festival over weekly offs
// and First Saturdays; drop "(Moved …)" annotations.
function breakTitle(brk) {
  const named = brk.reasons.find((r) => r !== 'Sunday' && !r.startsWith('First Saturday'));
  const title = named || brk.reasons.find((r) => r !== 'Sunday') || 'Long weekend';
  return title.replace(/\s*\(Moved[^)]*\)/i, '');
}

function breakLine(brk) {
  return `*${breakTitle(brk)}* break — ${brk.days} days leave (*${shortDate(brk.start)} – ${shortDate(brk.end)}*)`;
}

function formatOutbound(brk) {
  return [
    '🎫 *Tomorrow is ticket opening!*',
    breakLine(brk),
    `Booking for ${shortDay(brk.start)} opens *tomorrow* on IRCTC — be ready at 8 AM! 🚂`,
  ].join('\n');
}

function formatReturn(brk) {
  return [
    '🔁 *Return ticket opens tomorrow!*',
    breakLine(brk),
    `Returning on ${shortDay(brk.end)}? Booking opens *tomorrow* on IRCTC — be ready at 8 AM! 🚂`,
  ].join('\n');
}

function formatTatkal(brk) {
  const eveBefore = shortDay(addDays(brk.start, -1));
  return [
    '⚡ *Tatkal alert!*',
    breakLine(brk),
    `Leaving tomorrow (${eveBefore}) night? Tatkal for ${eveBefore} trains opens *TODAY at 11 AM* (AC: 10 AM)! ⏰`,
    `Tatkal for ${shortDay(brk.start)} trains opens tomorrow at 11 AM.`,
  ].join('\n');
}

/**
 * All notification events due today, each with a unique dedup key. Alerts fire
 * only on their exact day — a missed day is skipped silently, never caught up
 * later (state is ephemeral on the free tier; catch-ups would repeat after
 * every restart).
 * - out:{start} — normal booking for the outbound journey (break start) opens
 *   NOTIFY_DAYS before it; alert the day before it opens.
 * - ret:{end} — same for the return journey (break end).
 * - tat:{start} — tatkal opens 1 day before travel at 11 AM; alert two days
 *   before the break (for the leave-the-night-before train).
 * - cal:{year}:{month} — the alert horizon reaches a year whose holiday list is
 *   missing; reminds the group once a month until it is added.
 * Returns [{ key, brk, message }].
 */
async function dueNotifications() {
  const todayStr = today();
  const notified = await store.getNotified();
  const due = [];
  const push = (key, brk, message) => {
    if (!notified.includes(key)) due.push({ key, brk, message: message + FOOTER });
  };

  const calendars = await store.getCalendars();

  const horizon = addDays(todayStr, NOTIFY_DAYS + 1 + CALENDAR_WARN_BUFFER);
  const loadedYears = new Set(calendars.map((c) => c.year));
  for (const year of new Set([Number(todayStr.slice(0, 4)), Number(horizon.slice(0, 4))])) {
    if (!loadedYears.has(year)) {
      push(
        `cal:${year}:${todayStr.slice(0, 7)}`,
        null,
        [
          `⚠️ *Holiday list for ${year} is not updated!*`,
          `Ticket alerts for ${year} breaks cannot be sent until it is added.`,
          `Admin: run the ingest script for the ${year} holiday list (see README → "Updating for a new year").`,
        ].join('\n')
      );
    }
  }

  for (const calendar of calendars) {
    for (const brk of findLongBreaks(calendar, MIN_BREAK_DAYS)) {
      const untilStart = daysBetween(todayStr, brk.start);
      const untilEnd = daysBetween(todayStr, brk.end);

      if (untilStart - NOTIFY_DAYS === 1) {
        push(`out:${brk.start}`, brk, formatOutbound(brk));
      }

      if (untilEnd - NOTIFY_DAYS === 1) {
        push(`ret:${brk.end}`, brk, formatReturn(brk));
      }

      if (untilStart === 2) {
        push(`tat:${brk.start}`, brk, formatTatkal(brk));
      }
    }
  }
  return due;
}

/**
 * Daily job: send every due notification via the given sender.
 * @param {(message: string) => Promise<void>} send
 * @param {{dryRun?: boolean}} opts
 */
async function runDailyCheck(send, opts = {}) {
  const due = await dueNotifications();
  if (due.length === 0) {
    console.log(`[notifier] ${today()}: no notifications due`);
    return [];
  }
  for (const item of due) {
    if (opts.dryRun) {
      console.log(`[notifier] DRY RUN — would send (${item.key}):\n${item.message}\n`);
      continue;
    }
    await send(item.message);
    await store.addNotified(item.key);
    console.log(`[notifier] sent ${item.key}`);
  }
  return due;
}

module.exports = {
  runDailyCheck,
  dueNotifications,
  formatOutbound,
  formatReturn,
  formatTatkal,
  today,
};
