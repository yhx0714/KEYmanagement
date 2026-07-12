const crypto = require("crypto");
const { fingerprint, nextId, nowIso } = require("../utils/ids");

function createIdentity(name) {
  const privateKeyRef = `connector-private://${crypto.randomBytes(12).toString("hex")}`;
  const publicKey = crypto.createHash("sha256").update(privateKeyRef).digest("base64");
  return {
    publicKey,
    privateKeyRef,
    publicKeyFingerprint: fingerprint(publicKey)
  };
}

function buildConnector({ name, role, attributes }) {
  const identity = createIdentity(name);
  return {
    connectorId: nextId("conn"),
    name,
    role,
    status: "PENDING",
    attributes: [...attributes],
    oldAttributeSets: [],
    abeUserKey: null,
    certificate: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    ...identity
  };
}

module.exports = {
  buildConnector
};
