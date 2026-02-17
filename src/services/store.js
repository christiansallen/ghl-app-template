const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "../../data");
const TOKENS_FILE = path.join(DATA_DIR, "tokens.json");
const TRIGGERS_FILE = path.join(DATA_DIR, "triggers.json");

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readJson(filePath) {
  ensureDataDir();
  if (!fs.existsSync(filePath)) return {};
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function writeJson(filePath, data) {
  ensureDataDir();
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

// --- Token storage (keyed by locationId) ---

function getTokens(locationId) {
  const all = readJson(TOKENS_FILE);
  return all[locationId] || null;
}

function saveTokens(locationId, tokenData) {
  const all = readJson(TOKENS_FILE);
  all[locationId] = {
    ...tokenData,
    updatedAt: new Date().toISOString(),
  };
  writeJson(TOKENS_FILE, all);
}

// --- Trigger subscription storage ---
// When a user adds your trigger to a workflow, GHL sends the targetUrl.
// Stored keyed by locationId so you know where to fire events.

function getTriggersByLocation(locationId) {
  const all = readJson(TRIGGERS_FILE);
  return all[locationId] || [];
}

function saveTriggerSubscription(locationId, triggerData) {
  const all = readJson(TRIGGERS_FILE);
  if (!all[locationId]) all[locationId] = [];

  // Upsert by trigger id
  const idx = all[locationId].findIndex((t) => t.id === triggerData.id);
  if (idx >= 0) {
    all[locationId][idx] = triggerData;
  } else {
    all[locationId].push(triggerData);
  }
  writeJson(TRIGGERS_FILE, all);
}

function removeTriggerSubscription(locationId, triggerId) {
  const all = readJson(TRIGGERS_FILE);
  if (!all[locationId]) return;
  all[locationId] = all[locationId].filter((t) => t.id !== triggerId);
  if (all[locationId].length === 0) delete all[locationId];
  writeJson(TRIGGERS_FILE, all);
}

module.exports = {
  getTokens,
  saveTokens,
  getTriggersByLocation,
  saveTriggerSubscription,
  removeTriggerSubscription,
};
