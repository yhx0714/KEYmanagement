const { resetIds } = require("../utils/ids");

const defaultAttributes = [
  "department=rd",
  "department=sales",
  "department=finance",
  "role=researcher",
  "role=auditor",
  "role=admin",
  "level=1",
  "level=2",
  "level=3",
  "project=alpha",
  "project=beta"
];

function createInitialState() {
  return {
    system: {
      status: "NOT_INITIALIZED",
      platformStatus: "NOT_READY",
      caStatus: "NOT_READY",
      aaStatus: "NOT_READY",
      kmsStatus: "NOT_READY",
      initializedAt: null
    },
    ca: {
      rootCertificate: null
    },
    aa: {
      publicKey: null,
      masterSecretRef: null,
      attributes: [...defaultAttributes]
    },
    kms: {
      masterKeys: [],
      keys: []
    },
    connectors: [],
    resources: [],
    logs: []
  };
}

let state = createInitialState();

function getState() {
  return state;
}

function resetState() {
  resetIds();
  state = createInitialState();
  return state;
}

module.exports = {
  defaultAttributes,
  getState,
  resetState
};
