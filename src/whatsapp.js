'use strict';

// WhatsApp client on Baileys — direct WebSocket, no browser. Chromium-based
// whatsapp-web.js needed 300-500MB and OOMed Render's free 512MB tier.

const pino = require('pino');
const store = require('./store');
const config = require('./config');
const { useAuthState } = require('./baileys-auth');
const baileys = require('baileys');

const makeWASocket = baileys.default || baileys.makeWASocket;
const { DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore } = baileys;

const logger = pino({ level: 'silent' });

const state = {
  sock: null,
  ready: false,
  latestQr: null, // raw QR string while waiting for scan
  groupId: null,
  sessionSaved: false,
  starting: false,
  reconnectDelay: 3000,
  clearAuth: null,
};

function createClient() {
  start().catch((err) => {
    console.error('[whatsapp] failed to start:', err.message);
    scheduleRestart();
  });
}

// Baileys sockets are single-use — every (re)connect builds a fresh one.
async function start() {
  if (state.starting) return;
  state.starting = true;
  try {
    const auth = await useAuthState();
    state.clearAuth = auth.clear;
    const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }));

    const sock = makeWASocket({
      version,
      auth: {
        creds: auth.state.creds,
        keys: makeCacheableSignalKeyStore(auth.state.keys, logger),
      },
      logger,
      syncFullHistory: false,
      markOnlineOnConnect: false,
      generateHighQualityLinkPreview: false,
    });
    state.sock = sock;

    sock.ev.on('creds.update', async () => {
      try {
        await auth.saveCreds();
        if (store.usingMongo() && !state.sessionSaved) {
          state.sessionSaved = true;
          console.log('[whatsapp] session saved to MongoDB — QR scan will survive restarts from now on');
        }
      } catch (err) {
        console.error('[whatsapp] failed to save credentials:', err.message);
      }
    });

    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;
      if (qr) {
        state.latestQr = qr;
        state.ready = false;
        console.log('[whatsapp] QR code received — open /qr in a browser and scan it with your phone');
      }
      if (connection === 'open') {
        state.latestQr = null;
        state.ready = true;
        state.reconnectDelay = 3000;
        console.log('[whatsapp] client ready');
      }
      if (connection === 'close') {
        state.ready = false;
        const code = lastDisconnect?.error?.output?.statusCode;
        if (code === DisconnectReason.loggedOut) {
          console.error('[whatsapp] logged out — clearing session, a new QR scan is required');
          state.sessionSaved = false;
          state
            .clearAuth()
            .catch((err) => console.error('[whatsapp] failed to clear auth state:', err.message))
            .finally(() => scheduleRestart(1000));
        } else {
          // Includes restartRequired (515), fired deliberately right after QR
          // pairing — Baileys requires an immediate new socket there.
          console.error(`[whatsapp] connection closed (code ${code}) — reconnecting`);
          scheduleRestart(code === DisconnectReason.restartRequired ? 500 : undefined);
        }
      }
    });
  } finally {
    state.starting = false;
  }
}

function scheduleRestart(delayMs) {
  const delay = delayMs ?? state.reconnectDelay;
  state.reconnectDelay = Math.min(state.reconnectDelay * 2, 60000);
  setTimeout(() => {
    start().catch((err) => {
      console.error('[whatsapp] restart failed:', err.message);
      scheduleRestart();
    });
  }, delay);
}

/** Resolve the target group chat id from invite code or name; caches result. */
async function resolveGroupId() {
  if (state.groupId) return state.groupId;
  const cached = await store.getGroupId();
  if (cached) {
    state.groupId = cached;
    return cached;
  }
  if (!state.ready) throw new Error('WhatsApp client not ready');

  const inviteCode = config.GROUP_INVITE_CODE
    .replace(/^https?:\/\/chat\.whatsapp\.com\//i, '')
    .replace(/[?#].*$/, '')
    .trim();

  if (inviteCode) {
    const info = await state.sock.groupGetInviteInfo(inviteCode);
    let groupId = info.id; // full JID like '1234567890@g.us'
    // Join the group if the bot's number isn't in it yet.
    try {
      await state.sock.groupMetadata(groupId);
    } catch {
      groupId = await state.sock.groupAcceptInvite(inviteCode);
    }
    state.groupId = groupId;
    await store.setGroupId(groupId);
    return groupId;
  }

  const groupName = config.GROUP_NAME;
  if (groupName) {
    const groups = await state.sock.groupFetchAllParticipating();
    const group = Object.values(groups).find((g) => g.subject === groupName);
    if (!group) throw new Error(`Group named "${groupName}" not found among the bot's groups`);
    state.groupId = group.id;
    await store.setGroupId(state.groupId);
    return state.groupId;
  }

  throw new Error('Set GROUP_INVITE_CODE or GROUP_NAME in the environment');
}

async function sendToGroup(message) {
  if (!state.ready) throw new Error('WhatsApp client not ready — scan the QR at /qr first');
  const groupId = await resolveGroupId();
  await state.sock.sendMessage(groupId, { text: message });
}

async function status() {
  return {
    ready: state.ready,
    awaitingQrScan: Boolean(state.latestQr),
    sessionStorage: store.usingMongo() ? `mongodb (saved: ${state.sessionSaved})` : 'local disk',
    groupId: state.groupId || (await store.getGroupId()),
  };
}

function latestQr() {
  return state.latestQr;
}

module.exports = { createClient, sendToGroup, status, latestQr };
