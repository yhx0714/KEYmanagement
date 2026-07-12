const crypto = require("crypto");
const aesCrypto = require("./aesCrypto");
const policyEngine = require("../policy/policyEngine");

function derivePolicyKey(masterSecretRef, policy) {
  return crypto
    .createHash("sha256")
    .update(`cpabe-demo:${masterSecretRef}:${policy}`)
    .digest("base64");
}

function encryptDek(dekBase64, policy, abePublicKey) {
  policyEngine.validate(policy);
  const policyKey = derivePolicyKey(abePublicKey.masterSecretRef, policy);
  const encrypted = aesCrypto.encrypt(dekBase64, policyKey);
  return Buffer.from(
    JSON.stringify({
      algorithm: "CP-ABE-DEMO",
      policy,
      publicKeyId: abePublicKey.keyId,
      encrypted
    }),
    "utf8"
  ).toString("base64");
}

function decryptDek(encryptedDek, userKey, attributes) {
  const packageJson = Buffer.from(encryptedDek, "base64").toString("utf8");
  const envelope = JSON.parse(packageJson);

  // Demo CP-ABE: policy satisfaction is checked explicitly, then the same policy
  // scoped secret is derived to unwrap the DEK. This preserves the workflow shape
  // while keeping the project dependency-free.
  if (!policyEngine.evaluate(envelope.policy, attributes)) {
    const error = new Error("POLICY_NOT_SATISFIED");
    error.reason = "POLICY_NOT_SATISFIED";
    throw error;
  }

  const policyKey = derivePolicyKey(userKey.masterSecretRef, envelope.policy);
  return aesCrypto.decrypt(envelope.encrypted, policyKey);
}

module.exports = {
  decryptDek,
  encryptDek
};
