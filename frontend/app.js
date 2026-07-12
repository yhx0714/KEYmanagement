const state = {
  connectors: [],
  resources: [],
  keys: []
};

const el = (id) => document.getElementById(id);

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await res.json();
  if (!data.ok) {
    throw new Error(data.error);
  }
  return data.data;
}

function splitAttrs(value) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function statusPill(value) {
  return `<span class="pill ${value}">${value}</span>`;
}

function renderResult(target, data) {
  const result = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  target.className = `result ${data && data.result === "DENIED" ? "denied" : "success"}`;
  target.textContent = result;
}

function renderStatus(data) {
  const items = [
    ["Platform", data.platformStatus],
    ["CA", data.caStatus],
    ["AA", data.aaStatus],
    ["KMS", data.kmsStatus],
    ["Connectors", data.connectorCount],
    ["Resources", data.resourceCount],
    ["Keys", data.keyCount]
  ];
  el("statusGrid").innerHTML = items
    .map(
      ([label, value]) => `
        <div class="status-item">
          <span>${label}</span>
          <strong>${typeof value === "string" ? statusPill(value) : value}</strong>
        </div>
      `
    )
    .join("");
}

function renderConnectors() {
  el("connectorsList").innerHTML =
    state.connectors
      .map(
        (connector) => `
          <div class="item">
            <div class="item-title">
              <span>${connector.name} · ${connector.role}</span>
              ${statusPill(connector.status)}
            </div>
            <div class="tags">
              ${connector.attributes.map((attr) => `<span class="tag">${attr}</span>`).join("")}
            </div>
            <p class="muted">证书：${connector.certificate?.certificateId || "-"} · ABE Key：${connector.abeUserKey?.keyId || "-"}</p>
          </div>
        `
      )
      .join("") || '<p class="muted">暂无 Connector</p>';

  const providerOptions = state.connectors
    .filter((item) => item.role === "PROVIDER")
    .map((item) => `<option value="${item.connectorId}">${item.name}</option>`)
    .join("");
  const consumerOptions = state.connectors
    .filter((item) => item.role === "CONSUMER")
    .map((item) => `<option value="${item.connectorId}">${item.name}</option>`)
    .join("");
  el("providerSelect").innerHTML = providerOptions;
  el("fileProviderSelect").innerHTML = providerOptions;
  el("consumerSelect").innerHTML = consumerOptions;
}

function renderResources() {
  el("resourceSelect").innerHTML = state.resources
    .map((item) => {
      const type = item.resourceType === "FILE" ? "文件" : "文本";
      return `<option value="${item.resourceId}">[${type}] ${item.name} · ${item.resourceId}</option>`;
    })
    .join("");
}

function renderKeys() {
  el("keysList").innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Key ID</th>
          <th>类型</th>
          <th>状态</th>
          <th>版本</th>
          <th>关联对象</th>
        </tr>
      </thead>
      <tbody>
        ${state.keys
          .map(
            (key) => `
              <tr>
                <td>${key.keyId}</td>
                <td>${key.keyType}</td>
                <td>${statusPill(key.status)}</td>
                <td>${key.version || "-"}</td>
                <td>${key.resourceId || key.connectorId || key.parentKeyId || "-"}</td>
              </tr>
            `
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function renderLogs(logs) {
  el("logsList").innerHTML =
    logs
      .slice(0, 12)
      .map(
        (log) => `
          <div class="log-entry ${log.result === "DENIED" ? "denied" : ""}">
            <strong>${log.operation}</strong> ${statusPill(log.result)}
            <div class="muted">${log.createdAt} · ${log.steps.join(" -> ")}</div>
          </div>
        `
      )
      .join("") || '<p class="muted">暂无日志</p>';
}

async function refresh() {
  const [status, connectors, resources, keys, logs] = await Promise.all([
    api("/api/system/status"),
    api("/api/connectors"),
    api("/api/data/resources"),
    api("/api/keys"),
    api("/api/logs")
  ]);
  state.connectors = connectors;
  state.resources = resources;
  state.keys = keys;
  renderStatus(status);
  renderConnectors();
  renderResources();
  renderKeys();
  renderLogs(logs);
}

function selectedResource() {
  const resourceId = el("resourceSelect").value;
  return state.resources.find((item) => item.resourceId === resourceId);
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function downloadBase64File(fileName, mimeType, contentBase64) {
  const byteCharacters = atob(contentBase64);
  const byteNumbers = Array.from(byteCharacters, (char) => char.charCodeAt(0));
  const blob = new Blob([new Uint8Array(byteNumbers)], { type: mimeType || "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName || "download.bin";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

async function main() {
  el("initBtn").addEventListener("click", async () => {
    const data = await api("/api/system/init", { method: "POST", body: {} });
    renderResult(el("encryptResult"), data);
    await refresh();
  });

  el("seedBtn").addEventListener("click", async () => {
    const data = await api("/api/system/seed", { method: "POST", body: {} });
    renderResult(el("encryptResult"), data);
    await refresh();
  });

  el("registerBtn").addEventListener("click", async () => {
    const data = await api("/api/connectors/register", {
      method: "POST",
      body: {
        name: el("connectorName").value,
        role: el("connectorRole").value,
        attributes: splitAttrs(el("connectorAttrs").value)
      }
    });
    renderResult(el("decryptResult"), data);
    await refresh();
  });

  el("encryptBtn").addEventListener("click", async () => {
    const data = await api("/api/data/encrypt", {
      method: "POST",
      body: {
        providerConnectorId: el("providerSelect").value,
        name: el("resourceName").value,
        plaintext: el("plaintextInput").value,
        abePolicy: el("policyInput").value
      }
    });
    renderResult(el("encryptResult"), data);
    await refresh();
  });

  el("fileUploadBtn").addEventListener("click", async () => {
    const file = el("fileInput").files[0];
    if (!file) {
      renderResult(el("fileUploadResult"), "请先选择一个本地文件。");
      return;
    }
    const contentBase64 = await fileToBase64(file);
    const data = await api("/api/files/upload", {
      method: "POST",
      body: {
        providerConnectorId: el("fileProviderSelect").value,
        name: file.name,
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        contentBase64,
        abePolicy: el("filePolicyInput").value
      }
    });
    renderResult(el("fileUploadResult"), data);
    await refresh();
  });

  el("decryptBtn").addEventListener("click", async () => {
    const resource = selectedResource();
    if (!resource || resource.resourceType === "FILE") {
      renderResult(el("decryptResult"), "当前选择的是文件资源，请点击“下载文件”。");
      return;
    }
    const data = await api("/api/data/decrypt", {
      method: "POST",
      body: {
        consumerConnectorId: el("consumerSelect").value,
        resourceId: resource.resourceId
      }
    });
    renderResult(el("decryptResult"), data);
    await refresh();
  });

  el("fileDownloadBtn").addEventListener("click", async () => {
    const resource = selectedResource();
    if (!resource || resource.resourceType !== "FILE") {
      renderResult(el("decryptResult"), "当前选择的不是文件资源，请先上传或选择一个文件资源。");
      return;
    }
    const data = await api("/api/files/download", {
      method: "POST",
      body: {
        consumerConnectorId: el("consumerSelect").value,
        resourceId: resource.resourceId
      }
    });
    renderResult(el("decryptResult"), {
      ...data,
      contentBase64: `[已返回 ${data.contentBase64.length} 个 Base64 字符，并触发浏览器下载]`
    });
    if (data.result === "SUCCESS") {
      downloadBase64File(data.fileName, data.mimeType, data.contentBase64);
    }
    await refresh();
  });

  el("setSalesBtn").addEventListener("click", async () => {
    const consumerId = el("consumerSelect").value;
    const data = await api(`/api/connectors/${consumerId}/attributes`, {
      method: "PUT",
      body: { attributes: ["department=sales", "role=researcher"] }
    });
    renderResult(el("decryptResult"), data);
    await refresh();
  });

  el("setRdBtn").addEventListener("click", async () => {
    const consumerId = el("consumerSelect").value;
    const data = await api(`/api/connectors/${consumerId}/attributes`, {
      method: "PUT",
      body: { attributes: ["department=rd", "role=researcher"] }
    });
    renderResult(el("decryptResult"), data);
    await refresh();
  });

  el("rekeyBtn").addEventListener("click", async () => {
    const resource = selectedResource();
    if (!resource) {
      renderResult(el("decryptResult"), "请先选择一个资源。");
      return;
    }
    const data = await api(`/api/data/resources/${resource.resourceId}/rekey`, {
      method: "POST",
      body: {}
    });
    renderResult(el("decryptResult"), data);
    await refresh();
  });

  el("revokeDekBtn").addEventListener("click", async () => {
    const resource = selectedResource();
    if (!resource) {
      renderResult(el("decryptResult"), "请先选择一个资源。");
      return;
    }
    const data = await api(`/api/keys/${resource.dekKeyId}/revoke`, {
      method: "POST",
      body: {}
    });
    renderResult(el("decryptResult"), data);
    await refresh();
  });

  document.querySelectorAll('[data-action="refresh"]').forEach((button) => {
    button.addEventListener("click", refresh);
  });

  try {
    await refresh();
  } catch (error) {
    await api("/api/system/init", { method: "POST", body: {} });
    await refresh();
  }
}

main().catch((error) => {
  renderResult(el("decryptResult"), error.message);
});
