const crypto = require("crypto");
const caService = require("../ca/caService");
const connectorService = require("../connector/connectorService");
const aesCrypto = require("../crypto/aesCrypto");
const cpabeDemo = require("../crypto/cpabeDemo");
const kmsService = require("../kms/kmsService");
const policyEngine = require("../policy/policyEngine");
const connectorRepository = require("../db/connectorRepository");
const connectorFileStorage = require("../storage/connectorFileStorage");
const localFileStorage = require("../storage/localFileStorage");
const { createInitialState, getState, replaceState, resetState } = require("../storage/store");
const { nextId, nowIso, seedIds } = require("../utils/ids");

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
  connectorRepository.saveAccessLog(log).catch(() => {});
  return log;
}

function requireReady(state) {
  if (state.system.status !== "READY") {
    throw new Error("SYSTEM_NOT_INITIALIZED");
  }
}

function bootstrapCore(state) {
  caService.initCa(state);
  const abeSecret = crypto.randomBytes(32).toString("base64");
  state.aa.publicKey = {
    keyId: "key-abe-public-001",
    algorithm: "CP-ABE-DEMO",
    masterSecretRef: `abe-master://${crypto.createHash("sha256").update(abeSecret).digest("hex")}`
  };
  state.aa.masterSecretRef = state.aa.publicKey.masterSecretRef;
  state.system.aaStatus = "READY";
  const masterKey = kmsService.initKms(state);
  state.system.status = "READY";
  state.system.platformStatus = "READY";
  state.system.initializedAt = nowIso();
  return masterKey;
}

async function saveSystemBootstrap(state, masterKey) {
  await connectorRepository.saveSystemSettings({
    caRootCertificate: state.ca.rootCertificate,
    aaPublicKey: state.aa.publicKey,
    aaMasterSecretRef: state.aa.masterSecretRef,
    initializedAt: state.system.initializedAt
  });
  await connectorRepository.saveDataKey(masterKey);
}

function collectIds(state) {
  const materialIds = state.kms.keys
    .map((key) => String(key.materialRef || "").split("/").pop())
    .filter(Boolean);
  return [
    state.ca.rootCertificate?.certificateId,
    state.aa.publicKey?.keyId,
    ...state.connectors.map((connector) => connector.connectorId),
    ...state.connectors.map((connector) => connector.certificate?.certificateId),
    ...state.connectors.flatMap((connector) =>
      (connector.ownedFiles || []).map((file) => file.connectorFileId)
    ),
    ...state.kms.keys.map((key) => key.keyId),
    ...materialIds,
    ...state.resources.map((resource) => resource.resourceId),
    ...state.logs.map((log) => log.logId)
  ].filter(Boolean);
}

async function restoreSystem() {
  const state = createInitialState();
  const settings = await connectorRepository.loadSystemSettings();
  const hasSavedSystem = settings && settings.aaPublicKey && settings.aaMasterSecretRef;

  if (hasSavedSystem) {
    state.ca.rootCertificate = settings.caRootCertificate || null;
    state.aa.publicKey = settings.aaPublicKey;
    state.aa.masterSecretRef = settings.aaMasterSecretRef;
    state.system.caStatus = state.ca.rootCertificate ? "READY" : "NOT_READY";
    state.system.aaStatus = "READY";
    state.system.status = "READY";
    state.system.platformStatus = "READY";
    state.system.kmsStatus = "READY";
    state.system.initializedAt = settings.initializedAt || nowIso();
  } else {
    const masterKey = bootstrapCore(state);
    await saveSystemBootstrap(state, masterKey);
  }

  state.connectors = (await connectorRepository.listConnectors()) || [];
  state.connectors.forEach((connector) => {
    connector.fileDirectory = connectorFileStorage.connectorDirectory(connector.connectorId);
    connector.oldAttributeSets = connector.oldAttributeSets || [];
    connector.ownedFiles = connector.ownedFiles || [];
    if (connector.abeUserKey && !connector.abeUserKey.masterSecretRef) {
      connector.abeUserKey.masterSecretRef = state.aa.masterSecretRef;
    }
  });

  const dataKeys = (await connectorRepository.listDataKeys()) || state.kms.keys;
  state.kms.keys = [...dataKeys];
  state.kms.masterKeys = dataKeys.filter((key) => key.keyType === "KMS_MASTER_KEY");
  if (state.kms.masterKeys.length === 0) {
    const masterKey = kmsService.initKms(state);
    await connectorRepository.saveDataKey(masterKey);
  }
  state.connectors.forEach((connector) => {
    if (connector.abeUserKey && !state.kms.keys.some((key) => key.keyId === connector.abeUserKey.keyId)) {
      state.kms.keys.push(connector.abeUserKey);
    }
  });

  state.resources = (await connectorRepository.listResources()) || [];
  state.logs = (await connectorRepository.listAccessLogs()) || [];
  replaceState(state);
  seedIds(collectIds(state));
  addLog(state, "SYSTEM_RESTORE", "platform", null, "SUCCESS", null, [
    "DATABASE_LOADED",
    "CONNECTORS_RESTORED",
    "RESOURCES_RESTORED",
    "KEYS_RESTORED",
    "PLATFORM_READY"
  ]);
  return status();
}

async function initSystem() {
  await connectorRepository.clearAllDemoData();
  connectorFileStorage.clearConnectorDirectories();
  localFileStorage.clearEncryptedFiles();
  const state = resetState();
  const masterKey = bootstrapCore(state);
  await saveSystemBootstrap(state, masterKey);
  addLog(state, "SYSTEM_INIT", "platform", null, "SUCCESS", null, [
    "CA_INITIALIZED",
    "AA_INITIALIZED",
    "KMS_INITIALIZED",
    "DATABASE_CLEARED",
    "LOCAL_STORAGE_CLEARED",
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
  connector.fileDirectory = connectorFileStorage.connectorDirectory(connector.connectorId);
  connector.ownedFiles = [];
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
    fileDirectory: connector.fileDirectory,
    ownedFiles: connector.ownedFiles || [],
    publicKeyFingerprint: connector.publicKeyFingerprint,
    createdAt: connector.createdAt,
    updatedAt: connector.updatedAt
  };
}

async function listConnectors() {
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

async function publishData(payload) {
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
    resourceType: "TEXT",
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
  await connectorRepository.saveDataKey(dek);
  await connectorRepository.saveResource(resource);
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
    resourceType: resource.resourceType || "TEXT",
    fileName: resource.fileName,
    mimeType: resource.mimeType,
    fileSize: resource.fileSize,
    storageType: resource.storageType,
    providerConnectorId: resource.providerConnectorId,
    status: resource.status,
    abePolicy: resource.abePolicy,
    keyVersion: resource.keyVersion,
    dekKeyId: resource.dekKeyId,
    ciphertextPreview: resource.encryptedData
      ? resource.encryptedData.ciphertext.slice(0, 48)
      : resource.ciphertextPreview,
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

function findConnectorFile(connector, connectorFileId) {
  const file = (connector.ownedFiles || []).find((item) => item.connectorFileId === connectorFileId);
  if (!file) {
    throw new Error("CONNECTOR_FILE_NOT_FOUND");
  }
  return file;
}

function assertActiveDekOrDenied(state, resource, consumer) {
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
    return { denied: denied(reason, resource, consumer, ["CONSUMER_CERT_VERIFIED", "RESOURCE_FOUND", reason]) };
  }
  return { dek };
}

function assertPolicyOrDenied(state, resource, consumer) {
  if (!policyEngine.evaluate(resource.abePolicy, consumer.attributes)) {
    addLog(state, "DATA_ACCESS", consumer.connectorId, resource.resourceId, "DENIED", "POLICY_NOT_SATISFIED", [
      "CONSUMER_CERT_VERIFIED",
      "RESOURCE_FOUND",
      "ATTRIBUTES_LOADED",
      "POLICY_NOT_SATISFIED"
    ]);
    return {
      denied: denied("POLICY_NOT_SATISFIED", resource, consumer, [
        "CONSUMER_CERT_VERIFIED",
        "RESOURCE_FOUND",
        "ATTRIBUTES_LOADED",
        "POLICY_NOT_SATISFIED"
      ])
    };
  }
  return { ok: true };
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
  if ((resource.resourceType || "TEXT") !== "TEXT") {
    throw new Error("USE_FILE_DOWNLOAD_API");
  }
  const dekCheck = assertActiveDekOrDenied(state, resource, consumer);
  if (dekCheck.denied) {
    return dekCheck.denied;
  }
  const policyCheck = assertPolicyOrDenied(state, resource, consumer);
  if (policyCheck.denied) {
    return policyCheck.denied;
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

async function importConnectorFile(payload) {
  const state = getState();
  requireReady(state);
  const connector = getConnector(state, payload.connectorId, "CONNECTOR");
  if (!payload.contentBase64) {
    throw new Error("FILE_CONTENT_REQUIRED");
  }

  const fileBuffer = Buffer.from(payload.contentBase64, "base64");
  const connectorFileId = nextId("cfile");
  const fileName = payload.fileName || `${connectorFileId}.bin`;
  const now = nowIso();
  const localPath = connectorFileStorage.writeConnectorFile(
    connector.connectorId,
    connectorFileId,
    fileName,
    fileBuffer
  );
  const fileRecord = {
    connectorFileId,
    connectorId: connector.connectorId,
    fileName,
    mimeType: payload.mimeType || "application/octet-stream",
    fileSize: fileBuffer.length,
    localPath,
    origin: "LOCAL_UPLOAD",
    status: "LOCAL",
    publishedResourceId: null,
    createdAt: now,
    updatedAt: now
  };
  connector.ownedFiles = connector.ownedFiles || [];
  connector.ownedFiles.push(fileRecord);
  await connectorRepository.saveConnectorFile(fileRecord);
  addLog(state, "CONNECTOR_FILE_IMPORT", connector.connectorId, connectorFileId, "SUCCESS", null, [
    "CONNECTOR_VERIFIED",
    "LOCAL_FILE_RECEIVED",
    "FILE_WRITTEN_TO_CONNECTOR_DIRECTORY",
    "FILE_METADATA_SAVED"
  ]);
  return fileRecord;
}

async function publishConnectorFile(payload) {
  const state = getState();
  requireReady(state);
  const provider = getConnector(state, payload.providerConnectorId, "PROVIDER");
  policyEngine.validate(payload.abePolicy);
  const connectorFile = findConnectorFile(provider, payload.connectorFileId);
  const resolvedPath = connectorFileStorage.resolveConnectorFilePath(connectorFile);
  if (resolvedPath !== connectorFile.localPath) {
    connectorFile.localPath = resolvedPath;
    connectorFile.updatedAt = nowIso();
    await connectorRepository.saveConnectorFile(connectorFile);
  }
  const fileBuffer = connectorFileStorage.readConnectorFile(resolvedPath);
  const resourceId = nextId("resource");
  const dek = kmsService.createDek(state, provider.connectorId, resourceId);
  const encryptedData = aesCrypto.encryptBuffer(fileBuffer, dek.material);
  const encryptedDek = cpabeDemo.encryptDek(dek.material, payload.abePolicy, state.aa.publicKey);
  const storage = localFileStorage.writeEncryptedFile(resourceId, encryptedData);
  dek.resourceId = resourceId;

  const resource = {
    resourceId,
    name: payload.name || connectorFile.fileName || resourceId,
    resourceType: "FILE",
    fileName: connectorFile.fileName,
    mimeType: connectorFile.mimeType || "application/octet-stream",
    fileSize: fileBuffer.length,
    providerConnectorId: provider.connectorId,
    sourceConnectorFileId: connectorFile.connectorFileId,
    status: "PUBLISHED",
    abePolicy: payload.abePolicy,
    keyVersion: 1,
    dekKeyId: dek.keyId,
    encryptedDek,
    encryptedData: null,
    ciphertextPreview: encryptedData.ciphertext.slice(0, 48),
    storageType: storage.storageType,
    storagePath: storage.storagePath,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  state.resources.push(resource);
  await connectorRepository.saveDataKey(dek);
  await connectorRepository.saveResource(resource);
  connectorFile.status = "PUBLISHED";
  connectorFile.publishedResourceId = resourceId;
  connectorFile.updatedAt = nowIso();
  await connectorRepository.updateConnectorFilePublished(connectorFile.connectorFileId, resourceId);
  addLog(state, "FILE_PUBLISH", provider.connectorId, resource.resourceId, "SUCCESS", null, [
    "PROVIDER_CERT_VERIFIED",
    "CONNECTOR_FILE_SELECTED",
    "POLICY_VALIDATED",
    "DEK_GENERATED",
    "FILE_AES_ENCRYPTED",
    "ENCRYPTED_FILE_STORED",
    "DEK_CPABE_ENCRYPTED",
    "FILE_RESOURCE_PUBLISHED"
  ]);
  return resourceView(resource, false);
}

async function downloadFile(payload) {
  const state = getState();
  requireReady(state);
  const consumer = getConnector(state, payload.consumerConnectorId, "CONSUMER");
  const resource = state.resources.find((item) => item.resourceId === payload.resourceId);
  if (!resource) {
    throw new Error("RESOURCE_NOT_FOUND");
  }
  if ((resource.resourceType || "TEXT") !== "FILE") {
    throw new Error("RESOURCE_IS_NOT_FILE");
  }
  if (resource.status !== "PUBLISHED") {
    throw new Error("RESOURCE_NOT_AVAILABLE");
  }

  const dekCheck = assertActiveDekOrDenied(state, resource, consumer);
  if (dekCheck.denied) {
    return dekCheck.denied;
  }
  const policyCheck = assertPolicyOrDenied(state, resource, consumer);
  if (policyCheck.denied) {
    return policyCheck.denied;
  }

  const encryptedData = localFileStorage.readEncryptedFile(resource.storagePath);
  const unwrappedDek = cpabeDemo.decryptDek(resource.encryptedDek, consumer.abeUserKey, consumer.attributes);
  const fileBuffer = aesCrypto.decryptBuffer(encryptedData, unwrappedDek);
  const connectorFileId = nextId("cfile");
  const downloadedPath = connectorFileStorage.writeConnectorFile(
    consumer.connectorId,
    connectorFileId,
    resource.fileName,
    fileBuffer
  );
  const now = nowIso();
  const fileRecord = {
    connectorFileId,
    connectorId: consumer.connectorId,
    fileName: resource.fileName,
    mimeType: resource.mimeType,
    fileSize: fileBuffer.length,
    localPath: downloadedPath,
    origin: "SYSTEM_DOWNLOAD",
    status: "DOWNLOADED",
    publishedResourceId: resource.resourceId,
    createdAt: now,
    updatedAt: now
  };
  consumer.ownedFiles = consumer.ownedFiles || [];
  consumer.ownedFiles.push(fileRecord);
  await connectorRepository.saveConnectorFile(fileRecord);
  const steps = [
    "CONSUMER_CERT_VERIFIED",
    "CONSUMER_STATUS_CHECKED",
    "RESOURCE_FOUND",
    "DEK_STATUS_ACTIVE",
    "ATTRIBUTES_LOADED",
    "POLICY_SATISFIED",
    "ENCRYPTED_FILE_LOADED",
    "DEK_CPABE_DECRYPTED",
    "FILE_AES_DECRYPTED",
    "FILE_WRITTEN_TO_CONNECTOR_DIRECTORY"
  ];
  addLog(state, "FILE_DOWNLOAD", consumer.connectorId, resource.resourceId, "SUCCESS", null, steps);
  return {
    result: "SUCCESS",
    resourceId: resource.resourceId,
    fileName: resource.fileName,
    mimeType: resource.mimeType,
    fileSize: fileBuffer.length,
    connectorFileId,
    savedToConnectorPath: downloadedPath,
    contentBase64: fileBuffer.toString("base64"),
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

async function revokeKey(keyId) {
  const state = getState();
  const key = kmsService.revokeKey(state, keyId);
  await connectorRepository.updateDataKey(key);
  addLog(state, "KEY_REVOKE", "platform", keyId, "SUCCESS", null, ["KEY_REVOKED"]);
  return kmsService.publicKeyView(key);
}

async function destroyKey(keyId) {
  const state = getState();
  const key = kmsService.destroyKey(state, keyId);
  await connectorRepository.updateDataKey(key);
  addLog(state, "KEY_DESTROY", "platform", keyId, "SUCCESS", null, ["KEY_DESTROYED"]);
  return kmsService.publicKeyView(key);
}

async function rekeyResource(resourceId) {
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
  const plaintextBuffer =
    (resource.resourceType || "TEXT") === "FILE"
      ? aesCrypto.decryptBuffer(localFileStorage.readEncryptedFile(resource.storagePath), oldDek.material)
      : Buffer.from(aesCrypto.decrypt(resource.encryptedData, oldDek.material), "utf8");
  const newDek = kmsService.createDek(state, resource.providerConnectorId, resource.resourceId);
  newDek.version = resource.keyVersion + 1;
  const newEncryptedData = aesCrypto.encryptBuffer(plaintextBuffer, newDek.material);
  if ((resource.resourceType || "TEXT") === "FILE") {
    localFileStorage.writeEncryptedFile(resource.resourceId, newEncryptedData);
    resource.ciphertextPreview = newEncryptedData.ciphertext.slice(0, 48);
  } else {
    resource.encryptedData = newEncryptedData;
  }
  resource.encryptedDek = cpabeDemo.encryptDek(newDek.material, resource.abePolicy, state.aa.publicKey);
  resource.dekKeyId = newDek.keyId;
  resource.keyVersion += 1;
  resource.updatedAt = nowIso();
  oldDek.status = "ROTATED";
  oldDek.updatedAt = nowIso();
  await connectorRepository.saveDataKey(newDek);
  await connectorRepository.updateDataKey(oldDek);
  await connectorRepository.saveResource(resource);
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
  downloadFile,
  destroyKey,
  importConnectorFile,
  initSystem,
  listConnectors,
  listKeys,
  listResources,
  logs,
  publishData,
  publishConnectorFile,
  registerConnector,
  rekeyResource,
  revokeKey,
  restoreSystem,
  status,
  updateConnectorAttributes
};
