const { isDbEnabled } = require("../config/env");
const { getPool } = require("./mysqlPool");

function splitAttribute(attribute) {
  const index = attribute.indexOf("=");
  if (index === -1) {
    return { attrKey: attribute, attrValue: "" };
  }
  return {
    attrKey: attribute.slice(0, index),
    attrValue: attribute.slice(index + 1)
  };
}

function joinAttribute(row) {
  return `${row.attr_key}=${row.attr_value}`;
}

function toMysqlDate(value) {
  return new Date(value || Date.now()).toISOString().slice(0, 19).replace("T", " ");
}

function parseJson(value, fallback) {
  if (!value) {
    return fallback;
  }
  try {
    return JSON.parse(value);
  } catch (error) {
    return fallback;
  }
}

async function saveConnector(connector) {
  if (!isDbEnabled()) {
    return;
  }
  const pool = getPool();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute(
      `
        INSERT INTO connectors
          (connector_id, name, role, status, public_key, private_key_ref,
           public_key_fingerprint, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          name = VALUES(name),
          role = VALUES(role),
          status = VALUES(status),
          public_key = VALUES(public_key),
          private_key_ref = VALUES(private_key_ref),
          public_key_fingerprint = VALUES(public_key_fingerprint),
          updated_at = VALUES(updated_at)
      `,
      [
        connector.connectorId,
        connector.name,
        connector.role,
        connector.status,
        connector.publicKey,
        connector.privateKeyRef,
        connector.publicKeyFingerprint,
        toMysqlDate(connector.createdAt),
        toMysqlDate(connector.updatedAt)
      ]
    );

    if (connector.certificate) {
      await connection.execute(
        `
          INSERT INTO connector_certificates
            (certificate_id, connector_id, issuer, subject, public_key,
             fingerprint, status, issued_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            issuer = VALUES(issuer),
            subject = VALUES(subject),
            public_key = VALUES(public_key),
            fingerprint = VALUES(fingerprint),
            status = VALUES(status)
        `,
        [
          connector.certificate.certificateId,
          connector.connectorId,
          connector.certificate.issuer,
          connector.certificate.subject,
          connector.certificate.publicKey,
          connector.certificate.fingerprint,
          connector.certificate.status,
          toMysqlDate(connector.certificate.issuedAt)
        ]
      );
    }

    await replaceActiveAttributes(connection, connector.connectorId, connector.attributes);
    if (connector.abeUserKey) {
      await saveAbeUserKey(connection, connector.abeUserKey);
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function clearAllDemoData() {
  if (!isDbEnabled()) {
    return;
  }
  const pool = getPool();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await safeExecute(connection, "DELETE FROM access_logs");
    await safeExecute(connection, "DELETE FROM data_keys");
    await safeExecute(connection, "DELETE FROM resources");
    await safeExecute(connection, "DELETE FROM system_settings");
    await safeExecute(connection, "DELETE FROM connector_files");
    await safeExecute(connection, "DELETE FROM connector_abe_keys");
    await safeExecute(connection, "DELETE FROM connector_attributes");
    await safeExecute(connection, "DELETE FROM connector_certificates");
    await safeExecute(connection, "DELETE FROM connectors");
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function safeExecute(connection, sql, params = []) {
  try {
    await connection.execute(sql, params);
  } catch (error) {
    if (error.code !== "ER_NO_SUCH_TABLE") {
      throw error;
    }
  }
}

async function replaceActiveAttributes(connection, connectorId, attributes) {
  await connection.execute(
    `
      UPDATE connector_attributes
      SET status = 'REVOKED', updated_at = NOW()
      WHERE connector_id = ? AND status = 'ACTIVE'
    `,
    [connectorId]
  );

  for (const attribute of attributes) {
    const { attrKey, attrValue } = splitAttribute(attribute);
    await connection.execute(
      `
        INSERT INTO connector_attributes
          (connector_id, attr_key, attr_value, status, created_at, updated_at)
        VALUES (?, ?, ?, 'ACTIVE', NOW(), NOW())
      `,
      [connectorId, attrKey, attrValue]
    );
  }
}

async function saveAbeUserKey(connection, abeUserKey) {
  await connection.execute(
    `
      INSERT INTO connector_abe_keys
        (key_id, connector_id, key_type, status, attributes_json,
         material_ref, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        status = VALUES(status),
        attributes_json = VALUES(attributes_json),
        material_ref = VALUES(material_ref),
        updated_at = VALUES(updated_at)
    `,
    [
      abeUserKey.keyId,
      abeUserKey.connectorId,
      abeUserKey.keyType,
      abeUserKey.status,
      JSON.stringify(abeUserKey.attributes || []),
      abeUserKey.materialRef,
      toMysqlDate(abeUserKey.createdAt),
      toMysqlDate(abeUserKey.updatedAt)
    ]
  );
}

async function saveAbeKeyStatus(abeUserKey) {
  if (!isDbEnabled() || !abeUserKey) {
    return;
  }
  const pool = getPool();
  await pool.execute(
    `
      UPDATE connector_abe_keys
      SET status = ?, updated_at = ?
      WHERE key_id = ?
    `,
    [abeUserKey.status, toMysqlDate(abeUserKey.updatedAt), abeUserKey.keyId]
  );
}

async function updateAttributes(connector) {
  if (!isDbEnabled()) {
    return;
  }
  const pool = getPool();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute(
      `
        UPDATE connectors
        SET updated_at = ?
        WHERE connector_id = ?
      `,
      [toMysqlDate(connector.updatedAt), connector.connectorId]
    );
    await replaceActiveAttributes(connection, connector.connectorId, connector.attributes);
    if (connector.abeUserKey) {
      await saveAbeUserKey(connection, connector.abeUserKey);
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function saveConnectorFile(fileRecord) {
  if (!isDbEnabled()) {
    return;
  }
  const pool = getPool();
  await pool.execute(
    `
      INSERT INTO connector_files
        (connector_file_id, connector_id, file_name, mime_type, file_size,
         local_path, origin, status, published_resource_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        file_name = VALUES(file_name),
        mime_type = VALUES(mime_type),
        file_size = VALUES(file_size),
        local_path = VALUES(local_path),
        origin = VALUES(origin),
        status = VALUES(status),
        published_resource_id = VALUES(published_resource_id),
        updated_at = VALUES(updated_at)
    `,
    [
      fileRecord.connectorFileId,
      fileRecord.connectorId,
      fileRecord.fileName,
      fileRecord.mimeType,
      fileRecord.fileSize,
      fileRecord.localPath,
      fileRecord.origin,
      fileRecord.status,
      fileRecord.publishedResourceId || null,
      toMysqlDate(fileRecord.createdAt),
      toMysqlDate(fileRecord.updatedAt)
    ]
  );
}

async function updateConnectorFilePublished(connectorFileId, resourceId) {
  if (!isDbEnabled()) {
    return;
  }
  const pool = getPool();
  await pool.execute(
    `
      UPDATE connector_files
      SET status = 'PUBLISHED',
          published_resource_id = ?,
          updated_at = NOW()
      WHERE connector_file_id = ?
    `,
    [resourceId, connectorFileId]
  );
}

async function listConnectors() {
  if (!isDbEnabled()) {
    return null;
  }
  const pool = getPool();
  const [connectors] = await pool.execute(
    `
      SELECT connector_id, name, role, status, public_key, private_key_ref,
             public_key_fingerprint, created_at, updated_at
      FROM connectors
      ORDER BY id ASC
    `
  );

  const result = [];
  for (const connector of connectors) {
    const [certificates] = await pool.execute(
      `
        SELECT certificate_id, issuer, subject, fingerprint, status, issued_at
        FROM connector_certificates
        WHERE connector_id = ?
        ORDER BY id DESC
        LIMIT 1
      `,
      [connector.connector_id]
    );
    const [attributes] = await pool.execute(
      `
        SELECT attr_key, attr_value
        FROM connector_attributes
        WHERE connector_id = ? AND status = 'ACTIVE'
        ORDER BY id ASC
      `,
      [connector.connector_id]
    );
    const [abeKeys] = await pool.execute(
      `
        SELECT key_id, key_type, status, attributes_json, material_ref,
               created_at, updated_at
        FROM connector_abe_keys
        WHERE connector_id = ?
        ORDER BY id DESC
        LIMIT 1
      `,
      [connector.connector_id]
    );
    const [files] = await pool.execute(
      `
        SELECT connector_file_id, connector_id, file_name, mime_type, file_size,
               local_path, origin, status, published_resource_id, created_at, updated_at
        FROM connector_files
        WHERE connector_id = ?
        ORDER BY id ASC
      `,
      [connector.connector_id]
    );

    const certificate = certificates[0]
      ? {
          certificateId: certificates[0].certificate_id,
          issuer: certificates[0].issuer,
          subject: certificates[0].subject,
          fingerprint: certificates[0].fingerprint,
          status: certificates[0].status,
          issuedAt: certificates[0].issued_at
        }
      : null;
    const abeKey = abeKeys[0]
      ? {
          keyId: abeKeys[0].key_id,
          keyType: abeKeys[0].key_type,
          status: abeKeys[0].status,
          attributes: parseJson(abeKeys[0].attributes_json, []),
          materialRef: abeKeys[0].material_ref,
          createdAt: abeKeys[0].created_at,
          updatedAt: abeKeys[0].updated_at
        }
      : null;

    result.push({
      connectorId: connector.connector_id,
      name: connector.name,
      role: connector.role,
      status: connector.status,
      certificate,
      attributes: attributes.map(joinAttribute),
      abeUserKey: abeKey,
      ownedFiles: files.map((file) => ({
        connectorFileId: file.connector_file_id,
        connectorId: file.connector_id,
        fileName: file.file_name,
        mimeType: file.mime_type,
        fileSize: Number(file.file_size),
        localPath: file.local_path,
        origin: file.origin,
        status: file.status,
        publishedResourceId: file.published_resource_id,
        createdAt: file.created_at,
        updatedAt: file.updated_at
      })),
      publicKey: connector.public_key,
      privateKeyRef: connector.private_key_ref,
      publicKeyFingerprint: connector.public_key_fingerprint,
      createdAt: connector.created_at,
      updatedAt: connector.updated_at
    });
  }
  return result;
}

async function saveSystemSettings(settings) {
  if (!isDbEnabled()) {
    return;
  }
  const pool = getPool();
  for (const [key, value] of Object.entries(settings)) {
    await pool.execute(
      `
        INSERT INTO system_settings (setting_key, setting_value, updated_at)
        VALUES (?, ?, NOW())
        ON DUPLICATE KEY UPDATE
          setting_value = VALUES(setting_value),
          updated_at = VALUES(updated_at)
      `,
      [key, typeof value === "string" ? value : JSON.stringify(value)]
    );
  }
}

async function loadSystemSettings() {
  if (!isDbEnabled()) {
    return null;
  }
  const pool = getPool();
  const [rows] = await pool.execute(
    `
      SELECT setting_key, setting_value
      FROM system_settings
    `
  );
  const settings = {};
  rows.forEach((row) => {
    settings[row.setting_key] = parseJson(row.setting_value, row.setting_value);
  });
  return settings;
}

async function saveDataKey(key) {
  if (!isDbEnabled() || !key) {
    return;
  }
  const pool = getPool();
  await pool.execute(
    `
      INSERT INTO data_keys
        (key_id, key_type, status, version, owner_id, connector_id, resource_id,
         parent_key_id, material, material_ref, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        key_type = VALUES(key_type),
        status = VALUES(status),
        version = VALUES(version),
        owner_id = VALUES(owner_id),
        connector_id = VALUES(connector_id),
        resource_id = VALUES(resource_id),
        parent_key_id = VALUES(parent_key_id),
        material = VALUES(material),
        material_ref = VALUES(material_ref),
        updated_at = VALUES(updated_at)
    `,
    [
      key.keyId,
      key.keyType,
      key.status,
      key.version || null,
      key.ownerId || null,
      key.connectorId || null,
      key.resourceId || null,
      key.parentKeyId || null,
      key.material || null,
      key.materialRef || null,
      toMysqlDate(key.createdAt),
      toMysqlDate(key.updatedAt)
    ]
  );
}

async function updateDataKey(key) {
  return saveDataKey(key);
}

async function listDataKeys() {
  if (!isDbEnabled()) {
    return null;
  }
  const pool = getPool();
  const [rows] = await pool.execute(
    `
      SELECT key_id, key_type, status, version, owner_id, connector_id, resource_id,
             parent_key_id, material, material_ref, created_at, updated_at
      FROM data_keys
      ORDER BY id ASC
    `
  );
  return rows.map((row) => ({
    keyId: row.key_id,
    keyType: row.key_type,
    status: row.status,
    version: row.version,
    ownerId: row.owner_id,
    connectorId: row.connector_id,
    resourceId: row.resource_id,
    parentKeyId: row.parent_key_id,
    material: row.material,
    materialRef: row.material_ref,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}

async function saveResource(resource) {
  if (!isDbEnabled()) {
    return;
  }
  const pool = getPool();
  await pool.execute(
    `
      INSERT INTO resources
        (resource_id, name, resource_type, file_name, mime_type, file_size,
         storage_type, storage_path, provider_connector_id, source_connector_file_id,
         status, abe_policy, key_version, dek_key_id, encrypted_dek,
         encrypted_data_json, ciphertext_preview, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        name = VALUES(name),
        resource_type = VALUES(resource_type),
        file_name = VALUES(file_name),
        mime_type = VALUES(mime_type),
        file_size = VALUES(file_size),
        storage_type = VALUES(storage_type),
        storage_path = VALUES(storage_path),
        provider_connector_id = VALUES(provider_connector_id),
        source_connector_file_id = VALUES(source_connector_file_id),
        status = VALUES(status),
        abe_policy = VALUES(abe_policy),
        key_version = VALUES(key_version),
        dek_key_id = VALUES(dek_key_id),
        encrypted_dek = VALUES(encrypted_dek),
        encrypted_data_json = VALUES(encrypted_data_json),
        ciphertext_preview = VALUES(ciphertext_preview),
        updated_at = VALUES(updated_at)
    `,
    [
      resource.resourceId,
      resource.name,
      resource.resourceType || "TEXT",
      resource.fileName || null,
      resource.mimeType || null,
      resource.fileSize || null,
      resource.storageType || null,
      resource.storagePath || null,
      resource.providerConnectorId,
      resource.sourceConnectorFileId || null,
      resource.status,
      resource.abePolicy,
      resource.keyVersion,
      resource.dekKeyId,
      resource.encryptedDek,
      resource.encryptedData ? JSON.stringify(resource.encryptedData) : null,
      resource.ciphertextPreview ||
        (resource.encryptedData ? resource.encryptedData.ciphertext.slice(0, 48) : null),
      toMysqlDate(resource.createdAt),
      toMysqlDate(resource.updatedAt)
    ]
  );
}

async function listResources() {
  if (!isDbEnabled()) {
    return null;
  }
  const pool = getPool();
  const [rows] = await pool.execute(
    `
      SELECT resource_id, name, resource_type, file_name, mime_type, file_size,
             storage_type, storage_path, provider_connector_id, source_connector_file_id,
             status, abe_policy, key_version, dek_key_id, encrypted_dek,
             encrypted_data_json, ciphertext_preview, created_at, updated_at
      FROM resources
      ORDER BY id ASC
    `
  );
  return rows.map((row) => ({
    resourceId: row.resource_id,
    name: row.name,
    resourceType: row.resource_type,
    fileName: row.file_name,
    mimeType: row.mime_type,
    fileSize: row.file_size === null ? undefined : Number(row.file_size),
    storageType: row.storage_type,
    storagePath: row.storage_path,
    providerConnectorId: row.provider_connector_id,
    sourceConnectorFileId: row.source_connector_file_id,
    status: row.status,
    abePolicy: row.abe_policy,
    keyVersion: row.key_version,
    dekKeyId: row.dek_key_id,
    encryptedDek: row.encrypted_dek,
    encryptedData: parseJson(row.encrypted_data_json, null),
    ciphertextPreview: row.ciphertext_preview,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}

async function saveAccessLog(log) {
  if (!isDbEnabled() || !log) {
    return;
  }
  const pool = getPool();
  await pool.execute(
    `
      INSERT INTO access_logs
        (log_id, operation, actor_id, target_id, result, reason, steps_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        operation = VALUES(operation),
        actor_id = VALUES(actor_id),
        target_id = VALUES(target_id),
        result = VALUES(result),
        reason = VALUES(reason),
        steps_json = VALUES(steps_json)
    `,
    [
      log.logId,
      log.operation,
      log.actorId || null,
      log.targetId || null,
      log.result,
      log.reason || null,
      JSON.stringify(log.steps || []),
      toMysqlDate(log.createdAt)
    ]
  );
}

async function listAccessLogs(limit = 100) {
  if (!isDbEnabled()) {
    return null;
  }
  const safeLimit = Math.max(1, Math.min(500, Number(limit) || 100));
  const pool = getPool();
  const [rows] = await pool.execute(
    `
      SELECT log_id, operation, actor_id, target_id, result, reason, steps_json, created_at
      FROM access_logs
      ORDER BY id DESC
      LIMIT ${safeLimit}
    `
  );
  return rows.map((row) => ({
    logId: row.log_id,
    operation: row.operation,
    actorId: row.actor_id,
    targetId: row.target_id,
    result: row.result,
    reason: row.reason,
    steps: parseJson(row.steps_json, []),
    createdAt: row.created_at
  }));
}

module.exports = {
  clearAllDemoData,
  listAccessLogs,
  listConnectors,
  listDataKeys,
  listResources,
  loadSystemSettings,
  saveAccessLog,
  saveAbeKeyStatus,
  saveConnector,
  saveConnectorFile,
  saveDataKey,
  saveResource,
  saveSystemSettings,
  updateDataKey,
  updateConnectorFilePublished,
  updateAttributes
};
