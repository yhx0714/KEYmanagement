const assert = require("assert");

process.env.DB_ENABLED = "false";

const platform = require("./platform/platformService");

async function run() {
  await platform.initSystem();

  const provider = await platform.registerConnector({
    name: "Connector A",
    role: "PROVIDER",
    attributes: ["department=rd", "role=researcher", "level=3"]
  });
  const consumer = await platform.registerConnector({
    name: "Connector B",
    role: "CONSUMER",
    attributes: ["department=rd", "role=researcher"]
  });

  assert.strictEqual((await platform.listConnectors()).length, 2);
  assert.ok(provider.fileDirectory);
  assert.ok(consumer.fileDirectory);

  const importedFile = await platform.importConnectorFile({
    connectorId: provider.connectorId,
    fileName: "demo.txt",
    mimeType: "text/plain",
    contentBase64: Buffer.from("hello trusted data space file", "utf8").toString("base64")
  });
  assert.strictEqual(importedFile.status, "LOCAL");

  const publishedFile = await platform.publishConnectorFile({
    providerConnectorId: provider.connectorId,
    connectorFileId: importedFile.connectorFileId,
    abePolicy: "department=rd AND role=researcher"
  });
  assert.strictEqual(publishedFile.resourceType, "FILE");

  const downloadedFile = await platform.downloadFile({
    consumerConnectorId: consumer.connectorId,
    resourceId: publishedFile.resourceId
  });
  assert.strictEqual(downloadedFile.result, "SUCCESS");
  assert.strictEqual(
    Buffer.from(downloadedFile.contentBase64, "base64").toString("utf8"),
    "hello trusted data space file"
  );

  const attrUpdate = await platform.updateConnectorAttributes(consumer.connectorId, [
    "department=sales",
    "role=researcher"
  ]);
  assert.strictEqual(attrUpdate.accessPreview[0].after, "DENIED");

  const denied = await platform.downloadFile({
    consumerConnectorId: consumer.connectorId,
    resourceId: publishedFile.resourceId
  });
  assert.strictEqual(denied.result, "DENIED");
  assert.strictEqual(denied.reason, "POLICY_NOT_SATISFIED");

  await platform.updateConnectorAttributes(consumer.connectorId, [
    "department=rd",
    "role=researcher"
  ]);
  const restored = await platform.downloadFile({
    consumerConnectorId: consumer.connectorId,
    resourceId: publishedFile.resourceId
  });
  assert.strictEqual(restored.result, "SUCCESS");

  const rekey = platform.rekeyResource(publishedFile.resourceId);
  assert.strictEqual(rekey.newVersion, 2);

  const revoked = platform.revokeKey(rekey.newDekKeyId);
  assert.strictEqual(revoked.status, "REVOKED");

  const deniedByDek = await platform.downloadFile({
    consumerConnectorId: consumer.connectorId,
    resourceId: publishedFile.resourceId
  });
  assert.strictEqual(deniedByDek.reason, "DEK_REVOKED");

  console.log("Demo flow test passed.");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
