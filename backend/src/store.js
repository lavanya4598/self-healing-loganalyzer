/**
 * In-memory data store (swap for a real DB like PostgreSQL in production).
 * Organised as named maps keyed by entity ID.
 *
 * Also transparently persisted to a local JSON file so that history
 * (analyses, anomalies, actions, approvals, plans, audit trail) survives
 * process restarts - e.g. nodemon reloading on a code change, or a normal
 * dev-server restart - instead of silently disappearing since this used to
 * be purely in-memory.
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'store.json');
const PERSISTED_KEYS = ['analyses', 'anomalies', 'actions', 'approvals', 'plans', 'audit'];

const store = {
  analyses: new Map(),
  anomalies: new Map(),
  actions: new Map(),
  approvals: new Map(),
  plans: new Map(),
  audit: [],
  users: new Map([
    // Seed demo users  (passwords: "password123" bcrypt-hashed at cost 10)
    ['user-1', {
      id: 'user-1',
      username: 'appsupport',
      passwordHash: '$2a$10$aPvniu0Q5K7kilOhFn4Ea.wMi/JmlUKmBCV997y8Qf.vjMSNRXAS.',
      role: 'app_support',
      name: 'Application Support',
      email: 'appsupport@example.com',
    }],
    ['user-2', {
      id: 'user-2',
      username: 'sdm',
      passwordHash: '$2a$10$aPvniu0Q5K7kilOhFn4Ea.wMi/JmlUKmBCV997y8Qf.vjMSNRXAS.',
      role: 'sdm',
      name: 'Service Delivery Manager',
      email: 'sdm@example.com',
    }],
    ['user-3', {
      id: 'user-3',
      username: 'sm',
      passwordHash: '$2a$10$aPvniu0Q5K7kilOhFn4Ea.wMi/JmlUKmBCV997y8Qf.vjMSNRXAS.',
      role: 'sm',
      name: 'Service Manager',
      email: 'sm@example.com',
    }],
    ['user-4', {
      id: 'user-4',
      username: 'im',
      passwordHash: '$2a$10$aPvniu0Q5K7kilOhFn4Ea.wMi/JmlUKmBCV997y8Qf.vjMSNRXAS.',
      role: 'im',
      name: 'Incident Manager',
      email: 'im@example.com',
    }],
  ]),
};

function loadPersisted() {
  try {
    if (!fs.existsSync(DATA_FILE)) return;
    const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
    for (const key of PERSISTED_KEYS) {
      if (!(key in raw)) continue;
      if (key === 'audit') {
        store.audit = Array.isArray(raw.audit) ? raw.audit : [];
      } else {
        store[key] = new Map(Object.entries(raw[key] || {}));
      }
    }
  } catch (err) {
    console.error(`[store] Failed to load persisted data from ${DATA_FILE}, starting fresh: ${err.message}`);
  }
}

function persist() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const raw = {};
    for (const key of PERSISTED_KEYS) {
      raw[key] = key === 'audit' ? store.audit : Object.fromEntries(store[key]);
    }
    fs.writeFileSync(DATA_FILE, JSON.stringify(raw));
  } catch (err) {
    console.error(`[store] Failed to persist data to ${DATA_FILE}: ${err.message}`);
  }
}

// Wrap each persisted Map's mutating methods so every existing call site
// (store.anomalies.set(...), etc.) transparently triggers a save - no route
// files need to change. Writes are cheap at this app's scale (local JSON
// file, small dataset), so we save synchronously and immediately rather
// than debouncing, to guarantee nothing is lost even on an abrupt restart.
function withAutosave(map) {
  const originalSet = map.set.bind(map);
  const originalDelete = map.delete.bind(map);
  map.set = (...args) => {
    const result = originalSet(...args);
    persist();
    return result;
  };
  map.delete = (...args) => {
    const result = originalDelete(...args);
    persist();
    return result;
  };
  return map;
}

loadPersisted();

for (const key of PERSISTED_KEYS) {
  if (key === 'audit') continue;
  withAutosave(store[key]);
}
const originalAuditPush = store.audit.push.bind(store.audit);
store.audit.push = (...args) => {
  const result = originalAuditPush(...args);
  persist();
  return result;
};

module.exports = store;
