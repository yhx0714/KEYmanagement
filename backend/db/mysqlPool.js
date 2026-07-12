const fs = require("fs");
const path = require("path");
const { isDbAutoInitEnabled, isDbEnabled } = require("../config/env");

let pool = null;

function requireMysql2() {
  try {
    return require("mysql2/promise");
  } catch (error) {
    const message = [
      "mysql2 dependency is not installed.",
      "Run `npm install` in the project directory before enabling DB mode."
    ].join(" ");
    throw new Error(message);
  }
}

function getPool() {
  if (!isDbEnabled()) {
    return null;
  }
  if (pool) {
    return pool;
  }

  const mysql = requireMysql2();
  pool = mysql.createPool({
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "key_management_demo",
    waitForConnections: true,
    connectionLimit: 10,
    charset: "utf8mb4"
  });
  return pool;
}

async function executeSchemaIfEnabled() {
  if (!isDbEnabled() || !isDbAutoInitEnabled()) {
    return;
  }
  const schemaPath = path.join(__dirname, "..", "..", "database", "schema.sql");
  const schema = fs.readFileSync(schemaPath, "utf8");
  const statements = schema
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);

  const mysql = requireMysql2();
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    multipleStatements: true
  });
  try {
    for (const statement of statements) {
      await connection.query(statement);
    }
  } finally {
    await connection.end();
  }
}

module.exports = {
  executeSchemaIfEnabled,
  getPool
};
