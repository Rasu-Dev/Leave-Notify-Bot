'use strict';

// Convert a holiday-list image into data/holidays-<year>.json in one command:
//
//   npm run ingest -- <image-path>
//
// The image must list holidays as two lines each, like the office list:
//   2026-01-14 - Wednesday
//   Pongal
//
// The script OCRs the image, extracts the dates and names, verifies each date
// against the weekday printed next to it (catches OCR misreads), and writes
// data/holidays-<year>.json. If that file already exists it writes
// data/holidays-<year>.draft.json instead so nothing is overwritten.
// ALWAYS review the output file against the image before deploying.

const fs = require('fs');
const path = require('path');
const { weekdayOf } = require('./breaks');

const DATA_DIR = path.join(__dirname, '..', 'data');

async function ocr(imagePath) {
  const { createWorker } = require('tesseract.js');
  console.log('Running OCR (first run downloads language data, ~10 MB)...');
  const worker = await createWorker('eng');
  const result = await worker.recognize(path.resolve(imagePath));
  await worker.terminate();
  return result.data.text;
}

function parseHolidays(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const holidays = [];
  const warnings = [];

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/(\d{4})-(\d{2})-(\d{2})\s*[-–]?\s*([A-Za-z]*)/);
    if (!match) continue;
    const date = `${match[1]}-${match[2]}-${match[3]}`;
    const printedWeekday = match[4];
    const name = (lines[i + 1] || '').replace(/\*/g, '').trim();

    if (!name || /\d{4}-\d{2}-\d{2}/.test(name)) {
      warnings.push(`${date}: holiday name missing — fill it in manually`);
    }

    let actualWeekday;
    try {
      actualWeekday = weekdayOf(date);
    } catch {
      warnings.push(`${date}: invalid date — OCR misread, fix manually`);
      continue;
    }
    // The image prints the weekday next to each date; a mismatch means OCR
    // misread the date digits.
    if (printedWeekday && printedWeekday.toLowerCase() !== actualWeekday.toLowerCase()) {
      warnings.push(
        `${date}: image says "${printedWeekday}" but ${date} is a ${actualWeekday} — check the date digits`
      );
    }

    holidays.push({ date, name: name || 'UNKNOWN — fill in manually' });
  }

  return { holidays, warnings };
}

async function main() {
  const imagePath = process.argv[2];
  if (!imagePath) {
    console.error('Usage: npm run ingest -- <image-path>');
    process.exit(1);
  }
  if (!fs.existsSync(imagePath)) {
    console.error(`Image not found: ${imagePath}`);
    process.exit(1);
  }

  const text = await ocr(imagePath);
  const { holidays, warnings } = parseHolidays(text);

  if (holidays.length === 0) {
    console.error('No dates found in the image. Raw OCR text:\n\n' + text);
    process.exit(1);
  }

  holidays.sort((a, b) => a.date.localeCompare(b.date));
  const years = [...new Set(holidays.map((h) => Number(h.date.slice(0, 4))))];
  if (years.length > 1) {
    console.warn(`⚠ Dates span multiple years (${years.join(', ')}) — probably an OCR error.`);
  }
  const year = years[0];
  const calendar = { year, weeklyOff: ['Sunday'], holidays };

  let outFile = path.join(DATA_DIR, `holidays-${year}.json`);
  if (fs.existsSync(outFile)) {
    outFile = path.join(DATA_DIR, `holidays-${year}.draft.json`);
    console.warn(`⚠ holidays-${year}.json already exists — writing to ${path.basename(outFile)} instead.`);
  }
  fs.writeFileSync(outFile, JSON.stringify(calendar, null, 2) + '\n');

  console.log(`\nExtracted ${holidays.length} holidays for ${year}:\n`);
  for (const h of holidays) {
    console.log(`  ${h.date}  ${weekdayOf(h.date).padEnd(9)} ${h.name}`);
  }
  if (warnings.length) {
    console.log('\n⚠ WARNINGS — fix these in the output file:');
    for (const w of warnings) console.log(`  - ${w}`);
  }
  console.log(`\nSaved to: ${outFile}`);
  console.log('REVIEW the file against the image, then commit + push (or restart the bot).');
  if (outFile.endsWith('.draft.json')) {
    console.log(`When happy, rename it to holidays-${year}.json (replacing the old file).`);
  }

  // With MongoDB configured, also push the calendar straight to the database
  // (only when it went to the final file — drafts need review first).
  if (require('./config').MONGODB_URI && !outFile.endsWith('.draft.json')) {
    const store = require('./store');
    await store.init();
    await store.upsertCalendar(calendar);
    await store.close();
    console.log(`Uploaded ${year} calendar to MongoDB — the hosted bot picks it up on its next check.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
