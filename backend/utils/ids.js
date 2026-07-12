const crypto = require("crypto");

const counters = {};

function nextId(prefix) {
  counters[prefix] = (counters[prefix] || 0) + 1;
  return `${prefix}-${String(counters[prefix]).padStart(3, "0")}`;
}

function fingerprint(value) {
  return `sha256:${crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 24)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function resetIds() {
  Object.keys(counters).forEach((key) => delete counters[key]);
}

module.exports = {
  nextId,
  fingerprint,
  nowIso,
  resetIds
};
