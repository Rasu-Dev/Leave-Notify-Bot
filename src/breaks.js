'use strict';

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// All date math uses UTC so results never depend on server timezone.
function toUtc(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function toDateStr(utcDate) {
  return utcDate.toISOString().slice(0, 10);
}

function addDays(dateStr, days) {
  return toDateStr(new Date(toUtc(dateStr).getTime() + days * DAY_MS));
}

function daysBetween(fromStr, toStr) {
  return Math.round((toUtc(toStr) - toUtc(fromStr)) / DAY_MS);
}

function weekdayOf(dateStr) {
  return WEEKDAYS[toUtc(dateStr).getUTCDay()];
}

/**
 * Compute long breaks from a holiday calendar.
 * A day is "off" if it's a weekly off (e.g. Sunday) or a listed holiday.
 * A long break is a run of >= minDays consecutive off calendar days.
 *
 * @param {{year: number, weeklyOff: string[], holidays: {date: string, name: string}[]}} calendar
 * @param {number} minDays
 * @returns {{start: string, end: string, days: number, reasons: string[]}[]}
 */
function findLongBreaks(calendar, minDays = 3) {
  const holidayByDate = new Map(calendar.holidays.map((h) => [h.date, h.name]));
  const weeklyOff = new Set(calendar.weeklyOff);

  const reasonFor = (dateStr) =>
    holidayByDate.get(dateStr) || (weeklyOff.has(weekdayOf(dateStr)) ? weekdayOf(dateStr) : null);

  const breaks = [];
  let day = `${calendar.year}-01-01`;
  const yearEnd = `${calendar.year}-12-31`;

  while (day <= yearEnd) {
    const reason = reasonFor(day);
    if (!reason) {
      day = addDays(day, 1);
      continue;
    }
    const start = day;
    const reasons = [];
    while (day <= yearEnd) {
      const r = reasonFor(day);
      if (!r) break;
      reasons.push(r);
      day = addDays(day, 1);
    }
    const end = addDays(day, -1);
    const length = daysBetween(start, end) + 1;
    if (length >= minDays) {
      breaks.push({ start, end, days: length, reasons });
    }
  }
  return breaks;
}

module.exports = { findLongBreaks, addDays, daysBetween, weekdayOf };
