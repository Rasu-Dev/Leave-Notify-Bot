'use strict';

const path = require('path');
const { Client, LocalAuth, RemoteAuth } = require('whatsapp-web.js');
const store = require('./store');
const config = require('./config');

const state = {
  client: null,
  ready: false,
  latestQr: null, // raw QR string while waiting for scan
  groupId: null,
  sessionSaved: false,
};

function authStrategy() {
  const dataPath = path.join(config.DATA_DIR, 'session');
  if (store.usingMongo()) {
    // Session lives in MongoDB — survives Render free-tier restarts (no disk).
    const { MongoStore } = require('wwebjs-mongo');
    return new RemoteAuth({
      store: new MongoStore({ mongoose: store.mongooseInstance() }),
      dataPath,
      backupSyncIntervalMs: 300000,
    });
  }
  return new LocalAuth({ dataPath });
}

function createClient() {
  const client = new Client({
    authStrategy: authStrategy(),
    puppeteer: {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    },
  });

  client.on('qr', (qr) => {
    state.latestQr = qr;
    state.ready = false;
    console.log('[whatsapp] QR code received — open /qr in a browser and scan it with your phone');
  });

  client.on('ready', () => {
    state.latestQr = null;
    state.ready = true;
    console.log('[whatsapp] client ready');
  });

  client.on('authenticated', () => console.log('[whatsapp] authenticated'));
  client.on('remote_session_saved', () => {
    state.sessionSaved = true;
    console.log('[whatsapp] session saved to MongoDB — QR scan will survive restarts from now on');
  });
  client.on('auth_failure', (msg) => console.error('[whatsapp] auth failure:', msg));
  client.on('disconnected', (reason) => {
    state.ready = false;
    console.error('[whatsapp] disconnected:', reason);
  });

  state.client = client;
  client.initialize();
  return client;
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
    const info = await state.client.getInviteInfo(inviteCode);
    let groupId = info.id?._serialized || `${info.id.user}@g.us`;
    // Join the group if the bot's number isn't in it yet.
    try {
      const chat = await state.client.getChatById(groupId);
      if (!chat) throw new Error('not a member');
    } catch {
      const joinedId = await state.client.acceptInvite(inviteCode);
      if (joinedId) groupId = typeof joinedId === 'string' ? joinedId : joinedId._serialized;
    }
    state.groupId = groupId;
    await store.setGroupId(groupId);
    return groupId;
  }

  const groupName = config.GROUP_NAME;
  if (groupName) {
    const chats = await state.client.getChats();
    const group = chats.find((c) => c.isGroup && c.name === groupName);
    if (!group) throw new Error(`Group named "${groupName}" not found among the bot's chats`);
    state.groupId = group.id._serialized;
    await store.setGroupId(state.groupId);
    return state.groupId;
  }

  throw new Error('Set GROUP_INVITE_CODE or GROUP_NAME in the environment');
}

async function sendToGroup(message) {
  if (!state.ready) throw new Error('WhatsApp client not ready — scan the QR at /qr first');
  const groupId = await resolveGroupId();
  await state.client.sendMessage(groupId, message);
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
