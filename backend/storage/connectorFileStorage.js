const fs = require("fs");
const path = require("path");

const CONNECTOR_ROOT = path.join(__dirname, "..", "..", "storage", "connectors");

function ensureConnectorRoot() {
  fs.mkdirSync(CONNECTOR_ROOT, { recursive: true });
}

function safeName(fileName) {
  return path.basename(fileName || "file.bin").replace(/[<>:"/\\|?*]/g, "_");
}

function connectorDirectory(connectorId) {
  ensureConnectorRoot();
  const directory = path.join(CONNECTOR_ROOT, connectorId);
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

function writeConnectorFile(connectorId, connectorFileId, fileName, buffer) {
  const directory = connectorDirectory(connectorId);
  const localPath = path.join(directory, `${connectorFileId}-${safeName(fileName)}`);
  fs.writeFileSync(localPath, buffer);
  return localPath;
}

function readConnectorFile(localPath) {
  return fs.readFileSync(localPath);
}

function clearConnectorDirectories() {
  if (fs.existsSync(CONNECTOR_ROOT)) {
    fs.rmSync(CONNECTOR_ROOT, { recursive: true, force: true });
  }
  ensureConnectorRoot();
  fs.writeFileSync(path.join(CONNECTOR_ROOT, ".gitkeep"), "");
}

module.exports = {
  clearConnectorDirectories,
  connectorDirectory,
  readConnectorFile,
  writeConnectorFile
};
