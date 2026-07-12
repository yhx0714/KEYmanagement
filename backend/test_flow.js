const assert = require("assert");

process.env.DB_ENABLED = "false";

const platform = require("./platform/platformService");

async function run() {
  const seeded = await platform.seedDemo();
  const access = platform.decryptData({
    consumerConnectorId: seeded.consumer.connectorId,
    resourceId: seeded.resource.resourceId
  });
  assert.strictEqual(access.result, "SUCCESS");
  assert.ok(access.plaintext.length > 0);

  const attrUpdate = await platform.updateConnectorAttributes(seeded.consumer.connectorId, [
    "department=sales",
    "role=researcher"
  ]);
  assert.strictEqual(attrUpdate.accessPreview[0].after, "DENIED");

  const denied = platform.decryptData({
    consumerConnectorId: seeded.consumer.connectorId,
    resourceId: seeded.resource.resourceId
  });
  assert.strictEqual(denied.result, "DENIED");
  assert.strictEqual(denied.reason, "POLICY_NOT_SATISFIED");

  await platform.updateConnectorAttributes(seeded.consumer.connectorId, [
    "department=rd",
    "role=researcher"
  ]);
  const restored = platform.decryptData({
    consumerConnectorId: seeded.consumer.connectorId,
    resourceId: seeded.resource.resourceId
  });
  assert.strictEqual(restored.result, "SUCCESS");

  const uploadedFile = platform.uploadFile({
    providerConnectorId: seeded.provider.connectorId,
    name: "demo.txt",
    fileName: "demo.txt",
    mimeType: "text/plain",
    contentBase64: Buffer.from("hello trusted data space file", "utf8").toString("base64"),
    abePolicy: "department=rd AND role=researcher"
  });
  assert.strictEqual(uploadedFile.resourceType, "FILE");

  const downloadedFile = platform.downloadFile({
    consumerConnectorId: seeded.consumer.connectorId,
    resourceId: uploadedFile.resourceId
  });
  assert.strictEqual(downloadedFile.result, "SUCCESS");
  assert.strictEqual(
    Buffer.from(downloadedFile.contentBase64, "base64").toString("utf8"),
    "hello trusted data space file"
  );

  const rekey = platform.rekeyResource(seeded.resource.resourceId);
  assert.strictEqual(rekey.newVersion, 2);

  const keys = platform.listKeys();
  const activeDek = keys.find((key) => key.keyId === rekey.newDekKeyId);
  assert.strictEqual(activeDek.status, "ACTIVE");

  const revoked = platform.revokeKey(rekey.newDekKeyId);
  assert.strictEqual(revoked.status, "REVOKED");

  const deniedByDek = platform.decryptData({
    consumerConnectorId: seeded.consumer.connectorId,
    resourceId: seeded.resource.resourceId
  });
  assert.strictEqual(deniedByDek.reason, "DEK_REVOKED");

  console.log("Demo flow test passed.");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
