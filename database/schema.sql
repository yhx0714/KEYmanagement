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
  master_secret_ref VARCHAR(255),
  material_ref VARCHAR(255),
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  INDEX idx_abe_key_connector_id (connector_id),
  CONSTRAINT fk_abe_key_connector
    FOREIGN KEY (connector_id) REFERENCES connectors(connector_id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS connector_files (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  connector_file_id VARCHAR(64) NOT NULL UNIQUE,
  connector_id VARCHAR(64) NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(128),
  file_size BIGINT NOT NULL,
  local_path VARCHAR(1024) NOT NULL,
  origin VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL,
  published_resource_id VARCHAR(64),
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  INDEX idx_connector_files_connector_id (connector_id),
  INDEX idx_connector_files_resource_id (published_resource_id),
  CONSTRAINT fk_file_connector
    FOREIGN KEY (connector_id) REFERENCES connectors(connector_id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS system_settings (
  setting_key VARCHAR(64) PRIMARY KEY,
  setting_value TEXT NOT NULL,
  updated_at DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS resources (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  resource_id VARCHAR(64) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  resource_type VARCHAR(32) NOT NULL,
  file_name VARCHAR(255),
  mime_type VARCHAR(128),
  file_size BIGINT,
  storage_type VARCHAR(64),
  storage_path VARCHAR(1024),
  provider_connector_id VARCHAR(64) NOT NULL,
  source_connector_file_id VARCHAR(64),
  status VARCHAR(32) NOT NULL,
  abe_policy TEXT NOT NULL,
  key_version INT NOT NULL,
  dek_key_id VARCHAR(64) NOT NULL,
  encrypted_dek LONGTEXT NOT NULL,
  encrypted_data_json LONGTEXT,
  ciphertext_preview VARCHAR(128),
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  INDEX idx_resources_provider_id (provider_connector_id),
  INDEX idx_resources_dek_key_id (dek_key_id),
  CONSTRAINT fk_resource_provider
    FOREIGN KEY (provider_connector_id) REFERENCES connectors(connector_id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS data_keys (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  key_id VARCHAR(64) NOT NULL UNIQUE,
  key_type VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL,
  version INT,
  owner_id VARCHAR(64),
  connector_id VARCHAR(64),
  resource_id VARCHAR(64),
  parent_key_id VARCHAR(64),
  material TEXT,
  material_ref VARCHAR(255),
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  INDEX idx_data_keys_resource_id (resource_id),
  INDEX idx_data_keys_connector_id (connector_id)
);

CREATE TABLE IF NOT EXISTS access_logs (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  log_id VARCHAR(64) NOT NULL UNIQUE,
  operation VARCHAR(64) NOT NULL,
  actor_id VARCHAR(64),
  target_id VARCHAR(64),
  result VARCHAR(32) NOT NULL,
  reason VARCHAR(255),
  steps_json TEXT,
  created_at DATETIME NOT NULL,
  INDEX idx_access_logs_actor_id (actor_id),
  INDEX idx_access_logs_target_id (target_id)
);
