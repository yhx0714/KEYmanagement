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

function resolveConnectorFilePath(fileRecord) {
  if (fileRecord.localPath && fs.existsSync(fileRecord.localPath)) {
    return fileRecord.localPath;
  }

  const directory = connectorDirectory(fileRecord.connectorId);
  const candidates = [];
  if (fileRecord.localPath) {
    candidates.push(path.join(directory, path.basename(fileRecord.localPath)));
  }
  candidates.push(path.join(directory, `${fileRecord.connectorFileId}-${safeName(fileRecord.fileName)}`));

  const existing = candidates.find((candidate) => fs.existsSync(candidate));
  if (existing) {
    return existing;
  }

  const prefix = `${fileRecord.connectorFileId}-`;
  const byId = fs
    .readdirSync(directory)
    .map((entry) => path.join(directory, entry))
    .find((candidate) => path.basename(candidate).startsWith(prefix) && fs.existsSync(candidate));
  if (byId) {
    return byId;
  }

  const error = new Error("CONNECTOR_FILE_CONTENT_NOT_FOUND");
  error.localPath = fileRecord.localPath || path.join(directory, `${prefix}${safeName(fileRecord.fileName)}`);
  throw error;
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
  resolveConnectorFilePath,
  writeConnectorFile
};
