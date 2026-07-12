CREATE DATABASE IF NOT EXISTS key_management_demo
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;

USE key_management_demo;

CREATE TABLE IF NOT EXISTS connectors (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  connector_id VARCHAR(64) NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL,
  role VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL,
  public_key TEXT,
  private_key_ref VARCHAR(255),
  public_key_fingerprint VARCHAR(128),
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS connector_certificates (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  certificate_id VARCHAR(64) NOT NULL UNIQUE,
  connector_id VARCHAR(64) NOT NULL,
  issuer VARCHAR(100),
  subject VARCHAR(100),
  public_key TEXT,
  fingerprint VARCHAR(128),
  status VARCHAR(32) NOT NULL,
  issued_at DATETIME NOT NULL,
  INDEX idx_cert_connector_id (connector_id),
  CONSTRAINT fk_cert_connector
    FOREIGN KEY (connector_id) REFERENCES connectors(connector_id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS connector_attributes (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  connector_id VARCHAR(64) NOT NULL,
  attr_key VARCHAR(64) NOT NULL,
  attr_value VARCHAR(128) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  INDEX idx_attr_connector_id (connector_id),
  CONSTRAINT fk_attr_connector
    FOREIGN KEY (connector_id) REFERENCES connectors(connector_id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS connector_abe_keys (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  key_id VARCHAR(64) NOT NULL UNIQUE,
  connector_id VARCHAR(64) NOT NULL,
  key_type VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL,
  attributes_json TEXT,
  material_ref VARCHAR(255),
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  INDEX idx_abe_key_connector_id (connector_id),
  CONSTRAINT fk_abe_key_connector
    FOREIGN KEY (connector_id) REFERENCES connectors(connector_id)
    ON DELETE CASCADE
);
