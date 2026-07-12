const crypto = require("crypto");
const { nextId, nowIso } = require("../utils/ids");
const aesCrypto = require("../crypto/aesCrypto");

function initKms(state) {
  const masterKey = {
    keyId: "key-kms-master-001",
    keyType: "KMS_MASTER_KEY",
    status: "ACTIVE",
    version: 1,
    materialRef: `kms-master://${crypto.randomBytes(12).toString("hex")}`,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  state.kms.masterKeys.push(masterKey);
  state.kms.keys.push(masterKey);
  state.system.kmsStatus = "READY";
  return masterKey;
}

function activeMasterKey(state) {
  return state.kms.masterKeys.find((key) => key.status === "ACTIVE");
}

function createDek(state, ownerId, resourceId) {
  if (state.system.kmsStatus !== "READY") {
    throw new Error("KMS_NOT_READY");
  }
  const master = activeMasterKey(state);
  const key = {
    keyId: nextId("key-dek"),
    keyType: "DATA_ENCRYPTION_KEY",
    status: "ACTIVE",
    version: 1,
    ownerId,
    resourceId: resourceId || null,
    parentKeyId: master.keyId,
    material: aesCrypto.generateDek(),
    materialRef: `memory://${nextId("dek-material")}`,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  state.kms.keys.push(key);
  return key;
}

function findKey(state, keyId) {
  return state.kms.keys.find((key) => key.keyId === keyId);
}

function revokeKey(state, keyId) {
  const key = findKey(state, keyId);
  if (!key) {
    throw new Error("KEY_NOT_FOUND");
  }
  if (key.status === "DESTROYED") {
    throw new Error("KEY_DESTROYED");
  }
  key.status = "REVOKED";
  key.updatedAt = nowIso();
  return key;
}

function destroyKey(state, keyId) {
  const key = findKey(state, keyId);
  if (!key) {
    throw new Error("KEY_NOT_FOUND");
  }
  if (key.status !== "REVOKED") {
    throw new Error("KEY_MUST_BE_REVOKED_FIRST");
  }
  key.status = "DESTROYED";
  key.material = null;
  key.materialRef = "destroyed";
  key.updatedAt = nowIso();
  return key;
}

function rotateMasterKey(state) {
  const current = activeMasterKey(state);
  if (current) {
    current.status = "ROTATED";
    current.updatedAt = nowIso();
  }
  const version = state.kms.masterKeys.length + 1;
  const masterKey = {
    keyId: `key-kms-master-${String(version).padStart(3, "0")}`,
    keyType: "KMS_MASTER_KEY",
    status: "ACTIVE",
    version,
    materialRef: `kms-master://${crypto.randomBytes(12).toString("hex")}`,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  state.kms.masterKeys.push(masterKey);
  state.kms.keys.push(masterKey);
  return masterKey;
}

function publicKeyView(key) {
  const { material, ...safe } = key;
  return safe;
}

module.exports = {
  createDek,
  destroyKey,
  findKey,
  initKms,
  publicKeyView,
  revokeKey,
  rotateMasterKey
};
