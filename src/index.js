'use strict';

const express = require('express');
const cron = require('node-cron');
const QRCode = require('qrcode');
const store = require('./store');
const whatsapp = require('./whatsapp');
const auth = require('./auth');
const { runDailyCheck, dueNotifications, today } = require('./notifier');

const { PORT, CRON_SCHEDULE, TZ: TIMEZONE } = require('./config');

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  await store.init();

  if (DRY_RUN) {
    // No WhatsApp, no server — just show what would be sent today and exit.
    const due = await runDailyCheck(null, { dryRun: true });
    console.log(`[dry-run] today=${today()}, due notifications: ${due.length}`);
    await store.close();
    process.exit(0);
  }

  whatsapp.createClient();

  const app = express();
  app.use(express.urlencoded({ extended: false }));
  auth.register(app);

  // Health checks stay public — used by Render's healthCheckPath and the keep-alive pinger.
  app.get('/', (_req, res) => res.json({ ok: true, service: 'leave-bot' }));
  app.get('/health', (_req, res) =>
    res.json({ ok: true, service: 'leave-bot', uptime: Math.round(process.uptime()) })
  );

  app.get('/status', auth.requireLogin, async (_req, res) => {
    res.json({
      ...(await whatsapp.status()),
      storage: store.usingMongo() ? 'mongodb' : 'files',
      today: today(),
      cron: CRON_SCHEDULE,
      timezone: TIMEZONE,
      pending: (await dueNotifications()).map(({ key, brk }) => ({
        key,
        start: brk?.start,
        end: brk?.end,
        days: brk?.days,
      })),
    });
  });

  app.get('/qr', auth.requireLogin, async (_req, res) => {
    const qr = whatsapp.latestQr();
    if (!qr) {
      const { ready } = await whatsapp.status();
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

  app.post('/test', auth.tokenOrLogin, async (_req, res) => {
    try {
      await whatsapp.sendToGroup(
        '✅ Leave-Bot test message — the bot is connected to this group.\n\n_note: this is an automated message_'
      );
      res.json({ sent: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Manual trigger of the daily check (same guard as /test).
  app.post('/run', auth.tokenOrLogin, async (_req, res) => {
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
}

main().catch((err) => {
  console.error('[fatal]', err);
  process.exit(1);
});
