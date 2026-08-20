'use strict';

// Baileys auth-state persistence: MongoDB when MONGODB_URI is set (Render free
// tier — no disk), Baileys' own multi-file store under DATA_DIR otherwise.

const fs = require('fs');
const path = require('path');
const store = require('./store');
const config = require('./config');
const { initAuthCreds, BufferJSON, proto, useMultiFileAuthState } = require('baileys');

let AuthDoc = null;

function model() {
  if (!AuthDoc) {
    const mongoose = store.mongooseInstance();
    AuthDoc = mongoose.model(
      'BaileysAuth',
      new mongoose.Schema({ _id: String, value: String }, { versionKey: false })
    );
  }
  return AuthDoc;
}

// BufferJSON round-trips the Buffers/Uint8Arrays inside creds and signal keys.
const toJSON = (v) => JSON.stringify(v, BufferJSON.replacer);
const fromJSON = (s) => (s == null ? null : JSON.parse(s, BufferJSON.reviver));

async function useMongoAuthState() {
  const doc = await model().findById('creds').lean();
  const creds = fromJSON(doc?.value) || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        async get(type, ids) {
          const docs = await model()
            .find({ _id: { $in: ids.map((id) => `${type}-${id}`) } })
            .lean();
          const byId = new Map(docs.map((d) => [d._id, d.value]));
          const out = {};
          for (const id of ids) {
            let value = fromJSON(byId.get(`${type}-${id}`));
            if (value && type === 'app-state-sync-key') {
              value = proto.Message.AppStateSyncKeyData.fromObject(value);
            }
            if (value) out[id] = value;
          }
          return out;
        },
        async set(data) {
          const ops = [];
          for (const type of Object.keys(data)) {
            for (const id of Object.keys(data[type])) {
              const _id = `${type}-${id}`;
              const value = data[type][id];
              ops.push(
                value == null
                  ? { deleteOne: { filter: { _id } } }
                  : {
                      replaceOne: {
                        filter: { _id },
                        replacement: { _id, value: toJSON(value) },
                        upsert: true,
                      },
                    }
              );
            }
          }
          if (ops.length) await model().bulkWrite(ops, { ordered: false });
        },
      },
    },
    saveCreds: async () =>
      model().replaceOne({ _id: 'creds' }, { _id: 'creds', value: toJSON(creds) }, { upsert: true }),
    clear: async () => model().deleteMany({}),
  };
}

async function useAuthState() {
  if (store.usingMongo()) return useMongoAuthState();
  const dir = path.join(config.DATA_DIR, 'baileys-auth');
  const { state, saveCreds } = await useMultiFileAuthState(dir);
  return {
    state,
    saveCreds,
    clear: async () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

module.exports = { useAuthState };
