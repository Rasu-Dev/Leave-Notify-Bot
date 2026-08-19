'use strict';

const fs = require('fs');
const path = require('path');
const { Client, LocalAuth } = require('whatsapp-web.js');

const DATA_DIR = process.env.DATA_DIR || './data';
const GROUP_CACHE_FILE = path.join(DATA_DIR, 'state', 'group.json');

const state = {
  client: null,
  ready: false,
  latestQr: null, // raw QR string while waiting for scan
  groupId: null,
};

function createClient() {
  const client = new Client({
    authStrategy: new LocalAuth({ dataPath: path.join(DATA_DIR, 'session') }),
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
  client.on('auth_failure', (msg) => console.error('[whatsapp] auth failure:', msg));
  client.on('disconnected', (reason) => {
    state.ready = false;
    console.error('[whatsapp] disconnected:', reason);
  });

  state.client = client;
  client.initialize();
  return client;
}

function loadCachedGroupId() {
  try {
    return JSON.parse(fs.readFileSync(GROUP_CACHE_FILE, 'utf8')).groupId;
  } catch {
    return null;
  }
}

function cacheGroupId(groupId) {
  fs.mkdirSync(path.dirname(GROUP_CACHE_FILE), { recursive: true });
  fs.writeFileSync(GROUP_CACHE_FILE, JSON.stringify({ groupId }, null, 2));
}

/** Resolve the target group chat id from invite code or name; caches result. */
async function resolveGroupId() {
  if (state.groupId) return state.groupId;
  const cached = loadCachedGroupId();
  if (cached) {
    state.groupId = cached;
    return cached;
  }
  if (!state.ready) throw new Error('WhatsApp client not ready');

  const inviteCode = (process.env.GROUP_INVITE_CODE || '')
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
    cacheGroupId(groupId);
    return groupId;
  }

  const groupName = process.env.GROUP_NAME;
  if (groupName) {
    const chats = await state.client.getChats();
    const group = chats.find((c) => c.isGroup && c.name === groupName);
    if (!group) throw new Error(`Group named "${groupName}" not found among the bot's chats`);
    state.groupId = group.id._serialized;
    cacheGroupId(state.groupId);
    return state.groupId;
  }

  throw new Error('Set GROUP_INVITE_CODE or GROUP_NAME in the environment');
}

async function sendToGroup(message) {
  if (!state.ready) throw new Error('WhatsApp client not ready — scan the QR at /qr first');
  const groupId = await resolveGroupId();
  await state.client.sendMessage(groupId, message);
}

function status() {
  return {
    ready: state.ready,
    awaitingQrScan: Boolean(state.latestQr),
    groupId: state.groupId || loadCachedGroupId(),
  };
}

function latestQr() {
  return state.latestQr;
}

module.exports = { createClient, sendToGroup, status, latestQr };
