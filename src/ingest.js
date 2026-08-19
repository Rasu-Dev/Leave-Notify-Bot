'use strict';

// One-time OCR ingest for future years' holiday images.
// Usage: node src/ingest.js <image-path> > data/holidays-2027.draft.json
// Review the draft by hand before renaming it to holidays-<year>.json.

const path = require('path');

async function main() {
  const imagePath = process.argv[2];
  if (!imagePath) {
    console.error('Usage: node src/ingest.js <image-path>');
    process.exit(1);
  }

  const { createWorker } = require('tesseract.js');
  const worker = await createWorker('eng');
  const {
    data: { text },
  } = await worker.recognize(path.resolve(imagePath));
  await worker.terminate();

  // Expected format per holiday (two lines):
  //   2026-01-14 - Wednesday
  //   Pongal
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const holidays = [];
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/(\d{4})-(\d{2})-(\d{2})/);
    if (!match) continue;
    const name = (lines[i + 1] || '').replace(/\*/g, '').trim() || 'UNKNOWN — fill in manually';
    holidays.push({ date: match[0], name });
  }

  if (holidays.length === 0) {
    console.error('No dates found — check the image or OCR output:\n' + text);
    process.exit(1);
  }

  const year = Number(holidays[0].date.slice(0, 4));
  console.log(JSON.stringify({ year, weeklyOff: ['Sunday'], holidays }, null, 2));
  console.error(`\nExtracted ${holidays.length} holidays. REVIEW the output before using it!`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
