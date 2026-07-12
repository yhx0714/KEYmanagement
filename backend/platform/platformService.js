const crypto = require("crypto");
const caService = require("../ca/caService");
const connectorService = require("../connector/connectorService");
const aesCrypto = require("../crypto/aesCrypto");
const cpabeDemo = require("../crypto/cpabeDemo");
const kmsService = require("../kms/kmsService");
const policyEngine = require("../policy/policyEngine");
const connectorRepository = require("../db/connectorRepository");
const { getState, resetState } = require("../storage/store");
const { nextId, nowIso } = require("../utils/ids");

function addLog(state, operation, actorId, targetId, result, reason, steps) {
  const log = {
    logId: nextId("log"),
    operation,
    actorId: actorId || null,
    targetId: targetId || null,
    result,
    reason: reason || null,
    steps,
    createdAt: nowIso()
  };
  state.logs.unshift(log);
  return log;
}

function requireReady(state) {
  if (state.system.status !== "READY") {
    throw new Error("SYSTEM_NOT_INITIALIZED");
  }
}

async function initSystem() {
  const state = resetState();
  caService.initCa(state);
  const abeSecret = crypto.randomBytes(32).toString("base64");
  state.aa.publicKey = {
    keyId: "key-abe-public-001",
    algorithm: "CP-ABE-DEMO",
    masterSecretRef: `abe-master://${crypto.createHash("sha256").update(abeSecret).digest("hex")}`
  };
  state.aa.masterSecretRef = state.aa.publicKey.masterSecretRef;
  state.system.aaStatus = "READY";
  kmsService.initKms(state);
  state.system.status = "READY";
  state.system.platformStatus = "READY";
  state.system.initializedAt = nowIso();
  addLog(state, "SYSTEM_INIT", "platform", null, "SUCCESS", null, [
    "CA_INITIALIZED",
    "AA_INITIALIZED",
    "KMS_INITIALIZED",
    "PLATFORM_READY"
  ]);
  return status();
}

function status() {
  const state = getState();
  return {
    systemStatus: state.system.status,
    platformStatus: state.system.platformStatus,
    caStatus: state.system.caStatus,
    aaStatus: state.system.aaStatus,
    kmsStatus: state.system.kmsStatus,
    initializedAt: state.system.initializedAt,
    connectorCount: state.connectors.length,
    resourceCount: state.resources.length,
    keyCount: state.kms.keys.length,
    defaultAttributes: state.aa.attributes
  };
}

function ensureAttributesDefined(state, attributes) {
  const unknown = attributes.filter((attr) => !state.aa.attributes.includes(attr));
  if (unknown.length > 0) {
    throw new Error(`ATTRIBUTE_NOT_DEFINED: ${unknown.join(", ")}`);
  }
}

async function issueAbeUserKey(state, connector) {
  const oldKey = connector.abeUserKey;
  if (oldKey && oldKey.status === "ACTIVE") {
    oldKey.status = "REVOKED";
    oldKey.updatedAt = nowIso();
    await connectorRepository.saveAbeKeyStatus(oldKey);
  }
  const key = {
    keyId: nextId("key-abe-user"),
    keyType: "ABE_USER_SECRET_KEY",
    status: "ACTIVE",
    connectorId: connector.connectorId,
    attributes: [...connector.attributes],
    masterSecretRef: state.aa.masterSecretRef,
    materialRef: `abe-user://${connector.connectorId}/${Date.now()}`,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  connector.abeUserKey = key;
  state.kms.keys.push(key);
  return key;
}

async function registerConnector(payload) {
  const state = getState();
  requireReady(state);
  const name = payload.name || `Connector ${state.connectors.length + 1}`;
  const role = payload.role || "CONSUMER";
  const attributes = payload.attributes || [];
  if (state.connectors.some((connector) => connector.name === name)) {
    throw new Error("CONNECTOR_ALREADY_EXISTS");
  }
  ensureAttributesDefined(state, attributes);

  const connector = connectorService.buildConnector({ name, role, attributes });
  connector.certificate = caService.issueCertificate(state, connector);
  connector.status = "REGISTERED";
  connector.abeUserKey = await issueAbeUserKey(state, connector);
  connector.updatedAt = nowIso();
  state.connectors.push(connector);
  await connectorRepository.saveConnector(connector);
  addLog(state, "CONNECTOR_REGISTER", connector.connectorId, connector.connectorId, "SUCCESS", null, [
    "IDENTITY_KEY_GENERATED",
    "CERTIFICATE_ISSUED",
    "CERTIFICATE_VERIFIED",
    "ATTRIBUTES_BOUND",
    "ABE_USER_KEY_ISSUED"
  ]);
  return connectorView(connector);
}

function connectorView(connector) {
  return {
    connectorId: connector.connectorId,
    name: connector.name,
    role: connector.role,
    status: connector.status,
    certificate: connector.certificate,
    attributes: connector.attributes,
    abeUserKey: connector.abeUserKey,
    publicKeyFingerprint: connector.publicKeyFingerprint,
    createdAt: connector.createdAt,
    updatedAt: connector.updatedAt
  };
}

async function listConnectors() {
  const dbConnectors = await connectorRepository.listConnectors();
  if (dbConnectors) {
    return dbConnectors;
  }
  return getState().connectors.map(connectorView);
}

function getConnector(state, connectorId, label) {
  const connector = state.connectors.find((item) => item.connectorId === connectorId);
  if (!connector) {
    throw new Error(`${label || "CONNECTOR"}_NOT_FOUND`);
  }
  if (connector.status !== "REGISTERED") {
    throw new Error(`${label || "CONNECTOR"}_NOT_REGISTERED`);
  }
  if (!caService.verifyCertificate(connector.certificate)) {
    throw new Error("CERTIFICATE_INVALID");
  }
  return connector;
}

function publishData(payload) {
  const state = getState();
  requireReady(state);
  const provider = getConnector(state, payload.providerConnectorId, "PROVIDER");
  policyEngine.validate(payload.abePolicy);

  const resourceId = nextId("resource");
  const dek = kmsService.createDek(state, provider.connectorId, resourceId);
  const encryptedData = aesCrypto.encrypt(payload.plaintext || "", dek.material);
  const encryptedDek = cpabeDemo.encryptDek(dek.material, payload.abePolicy, state.aa.publicKey);
  dek.resourceId = resourceId;

  const resource = {
    resourceId,
    name: payload.name || resourceId,
    providerConnectorId: provider.connectorId,
    status: "PUBLISHED",
    abePolicy: payload.abePolicy,
    keyVersion: 1,
    dekKeyId: dek.keyId,
    encryptedDek,
    encryptedData,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  state.resources.push(resource);
  addLog(state, "DATA_PUBLISH", provider.connectorId, resource.resourceId, "SUCCESS", null, [
    "PROVIDER_CERT_VERIFIED",
    "POLICY_VALIDATED",
    "DEK_GENERATED",
    "DATA_AES_ENCRYPTED",
    "DEK_CPABE_ENCRYPTED",
    "RESOURCE_PUBLISHED"
  ]);
  return resourceView(resource, true);
}

function resourceView(resource, includeCiphertext) {
  return {
    resourceId: resource.resourceId,
    name: resource.name,
    providerConnectorId: resource.providerConnectorId,
    status: resource.status,
    abePolicy: resource.abePolicy,
    keyVersion: resource.keyVersion,
    dekKeyId: resource.dekKeyId,
    ciphertextPreview: resource.encryptedData.ciphertext.slice(0, 48),
    encryptedDekPreview: resource.encryptedDek.slice(0, 48),
    encryptedData: includeCiphertext ? resource.encryptedData : undefined,
    encryptedDek: includeCiphertext ? resource.encryptedDek : undefined,
    createdAt: resource.createdAt,
    updatedAt: resource.updatedAt
  };
}

function listResources() {
  return getState().resources.map((resource) => resourceView(resource, false));
}

function decryptData(payload) {
  const state = getState();
  requireReady(state);
  const consumer = getConnector(state, payload.consumerConnectorId, "CONSUMER");
  const resource = state.resources.find((item) => item.resourceId === payload.resourceId);
  if (!resource) {
    throw new Error("RESOURCE_NOT_FOUND");
  }
  if (resource.status !== "PUBLISHED") {
    throw new Error("RESOURCE_NOT_AVAILABLE");
  }
  const dek = kmsService.findKey(state, resource.dekKeyId);
  if (!dek) {
    throw new Error("DEK_NOT_FOUND");
  }
  if (dek.status !== "ACTIVE") {
    const reason = dek.status === "REVOKED" ? "DEK_REVOKED" : "DEK_NOT_ACTIVE";
    addLog(state, "DATA_ACCESS", consumer.connectorId, resource.resourceId, "DENIED", reason, [
      "CONSUMER_CERT_VERIFIED",
      "RESOURCE_FOUND",
      reason
    ]);
    return denied(reason, resource, consumer, ["CONSUMER_CERT_VERIFIED", "RESOURCE_FOUND", reason]);
  }
  if (!policyEngine.evaluate(resource.abePolicy, consumer.attributes)) {
    addLog(state, "DATA_ACCESS", consumer.connectorId, resource.resourceId, "DENIED", "POLICY_NOT_SATISFIED", [
      "CONSUMER_CERT_VERIFIED",
      "RESOURCE_FOUND",
      "ATTRIBUTES_LOADED",
      "POLICY_NOT_SATISFIED"
    ]);
    return denied("POLICY_NOT_SATISFIED", resource, consumer, [
      "CONSUMER_CERT_VERIFIED",
      "RESOURCE_FOUND",
      "ATTRIBUTES_LOADED",
      "POLICY_NOT_SATISFIED"
    ]);
  }

  const unwrappedDek = cpabeDemo.decryptDek(resource.encryptedDek, consumer.abeUserKey, consumer.attributes);
  const plaintext = aesCrypto.decrypt(resource.encryptedData, unwrappedDek);
  const steps = [
    "CONSUMER_CERT_VERIFIED",
    "CONSUMER_STATUS_CHECKED",
    "RESOURCE_FOUND",
    "DEK_STATUS_ACTIVE",
    "ATTRIBUTES_LOADED",
    "POLICY_SATISFIED",
    "ABE_USER_KEY_READY",
    "DEK_CPABE_DECRYPTED",
    "DATA_AES_DECRYPTED"
  ];
  addLog(state, "DATA_ACCESS", consumer.connectorId, resource.resourceId, "SUCCESS", null, steps);
  return {
    result: "SUCCESS",
    plaintext,
    resourceId: resource.resourceId,
    consumerConnectorId: consumer.connectorId,
    matchedPolicy: resource.abePolicy,
    consumerAttributes: consumer.attributes,
    steps
  };
}

function denied(reason, resource, consumer, steps) {
  return {
    result: "DENIED",
    reason,
    resourceId: resource.resourceId,
    requiredPolicy: resource.abePolicy,
    consumerAttributes: consumer.attributes,
    steps
  };
}

async function updateConnectorAttributes(connectorId, attributes) {
  const state = getState();
  requireReady(state);
  ensureAttributesDefined(state, attributes);
  const connector = getConnector(state, connectorId, "CONNECTOR");
  const oldAttributes = [...connector.attributes];
  connector.oldAttributeSets.push({
    attributes: oldAttributes,
    status: "REVOKED",
    revokedAt: nowIso()
  });
  connector.attributes = [...attributes];
  const oldKeyId = connector.abeUserKey ? connector.abeUserKey.keyId : null;
  const newKey = await issueAbeUserKey(state, connector);
  connector.updatedAt = nowIso();
  await connectorRepository.updateAttributes(connector);
  const accessPreview = state.resources.map((resource) => ({
    resourceId: resource.resourceId,
    policy: resource.abePolicy,
    before: policyEngine.evaluate(resource.abePolicy, oldAttributes) ? "ALLOWED" : "DENIED",
    after: policyEngine.evaluate(resource.abePolicy, attributes) ? "ALLOWED" : "DENIED"
  }));
  addLog(state, "ATTRIBUTE_UPDATE", connector.connectorId, connector.connectorId, "SUCCESS", null, [
    "OLD_ATTRIBUTES_REVOKED",
    "NEW_ATTRIBUTES_BOUND",
    "OLD_ABE_KEY_REVOKED",
    "NEW_ABE_KEY_ISSUED",
    "ACCESS_RECALCULATED"
  ]);
  return {
    connectorId,
    oldAttributes,
    newAttributes: connector.attributes,
    revokedAbeKeyId: oldKeyId,
    newAbeKeyId: newKey.keyId,
    accessPreview,
    steps: [
      "OLD_ATTRIBUTES_REVOKED",
      "NEW_ATTRIBUTES_BOUND",
      "OLD_ABE_KEY_REVOKED",
      "NEW_ABE_KEY_ISSUED",
      "ACCESS_RECALCULATED"
    ]
  };
}

function listKeys() {
  return getState().kms.keys.map(kmsService.publicKeyView);
}

function revokeKey(keyId) {
  const state = getState();
  const key = kmsService.revokeKey(state, keyId);
  addLog(state, "KEY_REVOKE", "platform", keyId, "SUCCESS", null, ["KEY_REVOKED"]);
  return kmsService.publicKeyView(key);
}

function destroyKey(keyId) {
  const state = getState();
  const key = kmsService.destroyKey(state, keyId);
  addLog(state, "KEY_DESTROY", "platform", keyId, "SUCCESS", null, ["KEY_DESTROYED"]);
  return kmsService.publicKeyView(key);
}

function rekeyResource(resourceId) {
  const state = getState();
  requireReady(state);
  const resource = state.resources.find((item) => item.resourceId === resourceId);
  if (!resource) {
    throw new Error("RESOURCE_NOT_FOUND");
  }
  const oldDek = kmsService.findKey(state, resource.dekKeyId);
  if (!oldDek || oldDek.status !== "ACTIVE") {
    throw new Error("OLD_DEK_NOT_ACTIVE");
  }
  const plaintext = aesCrypto.decrypt(resource.encryptedData, oldDek.material);
  const newDek = kmsService.createDek(state, resource.providerConnectorId, resource.resourceId);
  newDek.version = resource.keyVersion + 1;
  resource.encryptedData = aesCrypto.encrypt(plaintext, newDek.material);
  resource.encryptedDek = cpabeDemo.encryptDek(newDek.material, resource.abePolicy, state.aa.publicKey);
  resource.dekKeyId = newDek.keyId;
  resource.keyVersion += 1;
  resource.updatedAt = nowIso();
  oldDek.status = "ROTATED";
  oldDek.updatedAt = nowIso();
  addLog(state, "RESOURCE_REKEY", "platform", resource.resourceId, "SUCCESS", null, [
    "NEW_DEK_GENERATED",
    "DATA_REENCRYPTED",
    "NEW_DEK_CPABE_ENCRYPTED",
    "OLD_DEK_ROTATED",
    "RESOURCE_KEY_VERSION_UPDATED"
  ]);
  return {
    resourceId: resource.resourceId,
    oldDekKeyId: oldDek.keyId,
    newDekKeyId: newDek.keyId,
    oldVersion: resource.keyVersion - 1,
    newVersion: resource.keyVersion,
    steps: [
      "NEW_DEK_GENERATED",
      "DATA_REENCRYPTED",
      "NEW_DEK_CPABE_ENCRYPTED",
      "OLD_DEK_ROTATED",
      "RESOURCE_KEY_VERSION_UPDATED"
    ]
  };
}

function logs() {
  return getState().logs;
}

async function seedDemo() {
  await initSystem();
  const a = await registerConnector({
    name: "Connector A",
    role: "PROVIDER",
    attributes: ["department=rd", "role=researcher", "level=3"]
  });
  const b = await registerConnector({
    name: "Connector B",
    role: "CONSUMER",
    attributes: ["department=rd", "role=researcher"]
  });
  const resource = publishData({
    providerConnectorId: a.connectorId,
    name: "研发数据样例",
    plaintext: "这是一份需要在可信数据空间中安全共享的研发数据。",
    abePolicy: "department=rd AND role=researcher"
  });
  return {
    status: status(),
    provider: a,
    consumer: b,
    resource
  };
}

module.exports = {
  decryptData,
  destroyKey,
  initSystem,
  listConnectors,
  listKeys,
  listResources,
  logs,
  publishData,
  registerConnector,
  rekeyResource,
  revokeKey,
  seedDemo,
  status,
  updateConnectorAttributes
};
