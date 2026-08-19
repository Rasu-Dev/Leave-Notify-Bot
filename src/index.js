'use strict';

const express = require('express');
const cron = require('node-cron');
const QRCode = require('qrcode');
const whatsapp = require('./whatsapp');
const { runDailyCheck, dueNotifications, today } = require('./notifier');

const DRY_RUN = process.argv.includes('--dry-run');
const PORT = process.env.PORT || 3000;
const CRON_SCHEDULE = process.env.CRON_SCHEDULE || '0 9 * * *';
const TIMEZONE = process.env.TZ || 'Asia/Kolkata';

if (DRY_RUN) {
  // No WhatsApp, no server — just show what would be sent today and exit.
  runDailyCheck(null, { dryRun: true }).then((due) => {
    console.log(`[dry-run] today=${today()}, due notifications: ${due.length}`);
    process.exit(0);
  });
  return;
}

whatsapp.createClient();

const app = express();

app.get('/', (_req, res) => res.json({ ok: true, service: 'leave-bot' }));

app.get('/status', (_req, res) => {
  res.json({
    ...whatsapp.status(),
    today: today(),
    cron: CRON_SCHEDULE,
    timezone: TIMEZONE,
    pending: dueNotifications().map(({ brk, daysUntil }) => ({
      start: brk.start,
      end: brk.end,
      days: brk.days,
      daysUntil,
    })),
  });
});

app.get('/qr', async (_req, res) => {
  const qr = whatsapp.latestQr();
  if (!qr) {
    const { ready } = whatsapp.status();
    return res
      .status(ready ? 200 : 503)
      .send(ready ? 'Already authenticated ✅' : 'No QR available yet — refresh in a few seconds.');
  }
  const dataUrl = await QRCode.toDataURL(qr, { width: 320 });
  res.send(`<html><body style="text-align:center;font-family:sans-serif">
    <h2>Scan with WhatsApp → Linked devices</h2>
    <img src="${dataUrl}" alt="WhatsApp QR">
    <p>This page auto-refreshes.</p>
    <script>setTimeout(() => location.reload(), 20000)</script>
  </body></html>`);
});

app.post('/test', async (req, res) => {
  if (!process.env.TEST_TOKEN || req.query.token !== process.env.TEST_TOKEN) {
    return res.status(403).json({ error: 'invalid token' });
  }
  try {
    await whatsapp.sendToGroup('✅ Leave-Bot test message — the bot is connected to this group.');
    res.json({ sent: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Manual trigger of the daily check (same guard as /test).
app.post('/run', async (req, res) => {
  if (!process.env.TEST_TOKEN || req.query.token !== process.env.TEST_TOKEN) {
    return res.status(403).json({ error: 'invalid token' });
  }
  try {
    const due = await runDailyCheck(whatsapp.sendToGroup);
    res.json({ sent: due.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`[server] listening on :${PORT}`));

cron.schedule(
  CRON_SCHEDULE,
  async () => {
    try {
      await runDailyCheck(whatsapp.sendToGroup);
    } catch (err) {
      console.error('[cron] daily check failed:', err.message);
    }
  },
  { timezone: TIMEZONE }
);
console.log(`[cron] daily check scheduled: "${CRON_SCHEDULE}" (${TIMEZONE})`);
