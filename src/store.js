'use strict';

// Storage layer: MongoDB when MONGODB_URI is set (Render free tier — no disk),
// plain files under DATA_DIR otherwise (local dev, tests, dry-run).

const fs = require('fs');
const path = require('path');
const config = require('./config');

const CALENDAR_DIR = path.join(__dirname, '..', 'data');
const STATE_FILE = path.join(config.DATA_DIR, 'state', 'notified.json');
const GROUP_FILE = path.join(config.DATA_DIR, 'state', 'group.json');

const usingMongo = () => Boolean(config.MONGODB_URI);

let mongoose = null;
let Calendar = null;
let Kv = null;

function localCalendars() {
  return fs
    .readdirSync(CALENDAR_DIR)
    .filter((f) => /^holidays-\d{4}\.json$/.test(f))
    .map((f) => JSON.parse(fs.readFileSync(path.join(CALENDAR_DIR, f), 'utf8')));
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

async function init() {
  if (!usingMongo() || mongoose) return;
  mongoose = require('mongoose');
  await mongoose.connect(config.MONGODB_URI);
  Calendar = mongoose.model(
    'Calendar',
    new mongoose.Schema({
      year: { type: Number, unique: true },
      weeklyOff: [String],
      holidays: [{ _id: false, date: String, name: String }],
    })
  );
  Kv = mongoose.model('Kv', new mongoose.Schema({ _id: String, value: mongoose.Schema.Types.Mixed }));
  // Seed calendars from the repo's JSON files for any year not in Mongo yet.
  for (const cal of localCalendars()) {
    await Calendar.updateOne({ year: cal.year }, { $setOnInsert: cal }, { upsert: true });
  }
  console.log('[store] MongoDB connected');
}

async function getCalendars() {
  if (usingMongo()) return Calendar.find().lean();
  return localCalendars();
}

/** Insert or fully replace one year's calendar (used by ingest). */
async function upsertCalendar(calendar) {
  if (!usingMongo()) throw new Error('MONGODB_URI not set');
  await Calendar.findOneAndReplace({ year: calendar.year }, calendar, { upsert: true });
}

async function getNotified() {
  if (usingMongo()) return (await Kv.findById('notified'))?.value || [];
  return readJson(STATE_FILE, { notified: [] }).notified;
}

async function addNotified(key) {
  if (usingMongo()) {
    await Kv.updateOne({ _id: 'notified' }, { $addToSet: { value: key } }, { upsert: true });
    return;
  }
  const keys = await getNotified();
  if (!keys.includes(key)) writeJson(STATE_FILE, { notified: [...keys, key] });
}

async function getGroupId() {
  if (usingMongo()) return (await Kv.findById('groupId'))?.value || null;
  return readJson(GROUP_FILE, {}).groupId || null;
}

async function setGroupId(groupId) {
  if (usingMongo()) {
    await Kv.updateOne({ _id: 'groupId' }, { value: groupId }, { upsert: true });
    return;
  }
  writeJson(GROUP_FILE, { groupId });
}

async function close() {
  if (mongoose) await mongoose.disconnect();
}

/** The live mongoose instance, for wwebjs-mongo's session store. */
function mongooseInstance() {
  return mongoose;
}

module.exports = {
  init,
  usingMongo,
  getCalendars,
  upsertCalendar,
  getNotified,
  addNotified,
  getGroupId,
  setGroupId,
  mongooseInstance,
  close,
};
