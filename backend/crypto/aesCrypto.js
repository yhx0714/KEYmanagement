const crypto = require("crypto");

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32;
const IV_LENGTH = 12;

function generateDek() {
  return crypto.randomBytes(KEY_LENGTH).toString("base64");
}

function encrypt(plaintext, dekBase64) {
  return encryptBuffer(Buffer.from(String(plaintext), "utf8"), dekBase64);
}

function encryptBuffer(buffer, dekBase64) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = Buffer.from(dekBase64, "base64");
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(buffer), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    algorithm: "AES-256-GCM",
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
    ciphertext: ciphertext.toString("base64")
  };
}

function decrypt(payload, dekBase64) {
  return decryptBuffer(payload, dekBase64).toString("utf8");
}

function decryptBuffer(payload, dekBase64) {
  const key = Buffer.from(dekBase64, "base64");
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(payload.iv, "base64"));
  decipher.setAuthTag(Buffer.from(payload.authTag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, "base64")),
    decipher.final()
  ]);
}

module.exports = {
  decrypt,
  decryptBuffer,
  encrypt,
  encryptBuffer,
  generateDek
};
