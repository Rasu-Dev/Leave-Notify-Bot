'use strict';

// All configuration in one place. Every value has a default so the bot runs
// with no .env file at all; set env vars only to override.

const config = {
  PORT: Number(process.env.PORT || 3000),
  CRON_SCHEDULE: process.env.CRON_SCHEDULE || '0 9 * * *',
  TZ: process.env.TZ || 'Asia/Kolkata',
  // IRCTC advance reservation period: booking opens this many days before the journey date.
  NOTIFY_DAYS: Number(process.env.NOTIFY_DAYS || 60),
  // Minimum continuous off-days for a break to be announced.
  MIN_BREAK_DAYS: Number(process.env.MIN_BREAK_DAYS || 2),
  // File storage location when MONGODB_URI is empty.
  DATA_DIR: process.env.DATA_DIR || './data',
  // Empty → everything stored as files under DATA_DIR instead of MongoDB.
  MONGODB_URI: process.env.MONGODB_URI || '',
  GROUP_INVITE_CODE: process.env.GROUP_INVITE_CODE || '',
  GROUP_NAME: process.env.GROUP_NAME || '',
  ADMIN_USER: process.env.ADMIN_USER || 'admin',
  ADMIN_PASS: process.env.ADMIN_PASS || 'admin',
  // Empty → /test and /run accept only the login session (no token shortcut).
  TEST_TOKEN: process.env.TEST_TOKEN || '',
};

if (!process.env.ADMIN_PASS) {
  console.warn('[config] ADMIN_PASS not set — using default login admin/admin. Set ADMIN_PASS in production!');
}

module.exports = config;
