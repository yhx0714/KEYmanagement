const fs = require("fs");
const path = require("path");

function loadEnvFile() {
  const envPath = path.join(__dirname, "..", "..", ".env");
  if (!fs.existsSync(envPath)) {
    return;
  }

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      return;
    }
    const separator = trimmed.indexOf("=");
    if (separator === -1) {
      return;
    }
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
  });
}

function isDbEnabled() {
  return String(process.env.DB_ENABLED || "false").toLowerCase() === "true";
}

function isDbAutoInitEnabled() {
  return String(process.env.DB_AUTO_INIT || "false").toLowerCase() === "true";
}

loadEnvFile();

module.exports = {
  isDbAutoInitEnabled,
  isDbEnabled
};
