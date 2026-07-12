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
      SELECT connector_id, name, role, status, public_key_fingerprint,
             created_at, updated_at
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
          attributes: JSON.parse(abeKeys[0].attributes_json || "[]"),
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
      publicKeyFingerprint: connector.public_key_fingerprint,
      createdAt: connector.created_at,
      updatedAt: connector.updated_at
    });
  }
  return result;
}

module.exports = {
  clearAllDemoData,
  listConnectors,
  saveAbeKeyStatus,
  saveConnector,
  saveConnectorFile,
  updateConnectorFilePublished,
  updateAttributes
};
