const crypto = require("crypto");
const { fingerprint, nextId, nowIso } = require("../utils/ids");

function initCa(state) {
  const rootPrivate = crypto.randomBytes(32).toString("base64");
  const rootPublic = crypto.createHash("sha256").update(rootPrivate).digest("base64");
  state.ca.rootCertificate = {
    certificateId: "cert-root-001",
    subject: "Trusted Data Space Demo CA",
    publicKey: rootPublic,
    fingerprint: fingerprint(rootPublic),
    status: "VALID",
    issuedAt: nowIso()
  };
  state.system.caStatus = "READY";
  return state.ca.rootCertificate;
}

function issueCertificate(state, connector) {
  if (state.system.caStatus !== "READY") {
    throw new Error("CA_NOT_READY");
  }
  const certMaterial = `${connector.connectorId}:${connector.publicKey}:${nowIso()}`;
  return {
    certificateId: nextId("cert"),
    subject: connector.name,
    connectorId: connector.connectorId,
    issuer: state.ca.rootCertificate.subject,
    publicKey: connector.publicKey,
    fingerprint: fingerprint(certMaterial),
    status: "VALID",
    issuedAt: nowIso()
  };
}

function verifyCertificate(certificate) {
  return Boolean(certificate && certificate.status === "VALID");
}

module.exports = {
  initCa,
  issueCertificate,
  verifyCertificate
};
