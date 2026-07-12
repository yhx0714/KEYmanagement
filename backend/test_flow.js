const assert = require("assert");
const platform = require("./platform/platformService");

async function run() {
  const seeded = await platform.seedDemo();
  const access = platform.decryptData({
    consumerConnectorId: seeded.consumer.connectorId,
    resourceId: seeded.resource.resourceId
  });
  assert.strictEqual(access.result, "SUCCESS");
  assert.ok(access.plaintext.includes("可信数据空间"));

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
