const fs = require("fs");
const path = require("path");

const STORAGE_ROOT = path.join(__dirname, "..", "..", "storage", "files");

function ensureStorageRoot() {
  fs.mkdirSync(STORAGE_ROOT, { recursive: true });
}

function encryptedFilePath(resourceId) {
  ensureStorageRoot();
  return path.join(STORAGE_ROOT, `${resourceId}.enc.json`);
}

function writeEncryptedFile(resourceId, encryptedData) {
  const filePath = encryptedFilePath(resourceId);
  const packageData = {
    resourceId,
    encryptedData,
    storedAt: new Date().toISOString()
  };
  fs.writeFileSync(filePath, JSON.stringify(packageData, null, 2), "utf8");
  return {
    storageType: "LOCAL_FILE",
    storagePath: filePath
  };
}

function readEncryptedFile(storagePath) {
  const content = fs.readFileSync(storagePath, "utf8");
  return JSON.parse(content).encryptedData;
}

function clearEncryptedFiles() {
  ensureStorageRoot();
  for (const entry of fs.readdirSync(STORAGE_ROOT)) {
    if (entry === ".gitkeep") {
      continue;
    }
    fs.rmSync(path.join(STORAGE_ROOT, entry), { recursive: true, force: true });
  }
}

module.exports = {
  clearEncryptedFiles,
  readEncryptedFile,
  writeEncryptedFile
};
