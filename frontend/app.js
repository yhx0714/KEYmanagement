const state = {
  connectors: [],
  resources: [],
  keys: [],
  defaultAttributes: []
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
    const error = new Error(data.error || "UNKNOWN_ERROR");
    error.code = data.error || "UNKNOWN_ERROR";
    throw error;
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

function summarizeValue(key, value) {
  if (typeof value !== "string") {
    return value;
  }
  const largeTextKeys = new Set([
    "contentBase64",
    "ciphertext",
    "encryptedDek",
    "privateKey",
    "material"
  ]);
  if (largeTextKeys.has(key)) {
    return `[已隐藏 ${value.length} 个字符]`;
  }
  if (value.length > 300) {
    return `${value.slice(0, 120)}... [已截断，总长度 ${value.length} 个字符]`;
  }
  return value;
}

function summarizeData(data) {
  if (Array.isArray(data)) {
    return data.map((item) => summarizeData(item));
  }
  if (!data || typeof data !== "object") {
    return data;
  }
  const summarized = {};
  Object.entries(data).forEach(([key, value]) => {
    if (value && typeof value === "object") {
      summarized[key] = summarizeData(value);
      return;
    }
    summarized[key] = summarizeValue(key, value);
  });
  return summarized;
}

function stringifyForDisplay(data) {
  return typeof data === "string" ? data : JSON.stringify(summarizeData(data), null, 2);
}

function renderResult(target, data) {
  const result = stringifyForDisplay(data);
  target.className = `result ${data && data.result === "DENIED" ? "denied" : "success"}`;
  target.textContent = result;
}

function showNotice(type, title, message, details = "") {
  const overlay = el("notifyOverlay");
  const dialog = el("notifyDialog");
  const badge = el("notifyBadge");
  el("notifyTitle").textContent = title;
  el("notifyMessage").textContent = message;
  el("notifyDetails").textContent = details;
  el("notifyDetails").hidden = !details;
  badge.textContent = type === "success" ? "成功" : type === "warning" ? "提示" : "失败";
  dialog.className = `notify-dialog ${type}`;
  overlay.hidden = false;
}

function closeNotice() {
  el("notifyOverlay").hidden = true;
}

function availableAttributesText() {
  return state.defaultAttributes.length
    ? `可用属性：\n${state.defaultAttributes.map((attr) => `- ${attr}`).join("\n")}`
    : "可用属性暂未加载，请先刷新页面或检查后端服务状态。";
}

function explainError(error) {
  const message = error.message || String(error);
  if (message.startsWith("ATTRIBUTE_NOT_DEFINED")) {
    return {
      title: "属性未定义",
      message: "你输入了系统未定义的属性。请从系统支持的属性中选择，并用英文逗号分隔。",
      details: `${message}\n\n正确示例：department=rd,role=researcher\n\n${availableAttributesText()}`
    };
  }
  if (message === "CONNECTOR_ALREADY_EXISTS") {
    return {
      title: "Connector 名称重复",
      message: "已经存在同名 Connector，请换一个名称后再添加。",
      details: ""
    };
  }
  if (message === "POLICY_INVALID" || message.startsWith("POLICY_INVALID")) {
    return {
      title: "访问策略格式错误",
      message: "请检查访问策略写法，属性之间用 AND 或 OR 连接。",
      details: `正确示例：department=rd AND role=researcher\n\n${availableAttributesText()}`
    };
  }
  if (message === "SYSTEM_NOT_INITIALIZED") {
    return {
      title: "系统未初始化",
      message: "系统基础状态未准备好。请刷新页面，或检查后端服务和数据库连接是否正常。",
      details: ""
    };
  }
  if (message === "CONNECTOR_FILE_CONTENT_NOT_FOUND") {
    return {
      title: "本地文件不存在",
      message: "数据库中有该 Connector 文件记录，但在 Connector 本地目录中没有找到对应文件。请确认文件没有被手动删除，或重新导入该文件。",
      details: ""
    };
  }
  return {
    title: "操作失败",
    message,
    details: ""
  };
}

async function runAction({ successTitle, successMessage, resultTarget, action, onSuccess }) {
  try {
    const data = await action();
    if (resultTarget) {
      renderResult(resultTarget, data);
    }
    if (data && data.result === "DENIED") {
      showNotice("error", "访问被拒绝", `失败原因：${data.reason || "UNKNOWN"}`, stringifyForDisplay(data));
    } else {
      showNotice("success", successTitle, successMessage, data ? stringifyForDisplay(data) : "");
      if (onSuccess) {
        await onSuccess(data);
      }
    }
    await refresh();
  } catch (error) {
    const friendly = explainError(error);
    if (resultTarget) {
      renderResult(resultTarget, error.message || String(error));
    }
    showNotice("error", friendly.title, friendly.message, friendly.details);
  }
}

function selectedConnector(selectId) {
  const connectorId = el(selectId).value;
  return state.connectors.find((item) => item.connectorId === connectorId);
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

function renderStatus(data) {
  state.defaultAttributes = data.defaultAttributes || [];
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
            <p class="muted">目录：${connector.fileDirectory || "-"}</p>
            <p class="muted">本地文件数：${(connector.ownedFiles || []).length}</p>
          </div>
        `
      )
      .join("") || '<p class="muted">暂无 Connector，请先手动新增。</p>';

  const allOptions = state.connectors
    .map((item) => `<option value="${item.connectorId}">${item.name}</option>`)
    .join("");
  const providerOptions = state.connectors
    .filter((item) => item.role === "PROVIDER")
    .map((item) => `<option value="${item.connectorId}">${item.name}</option>`)
    .join("");
  const consumerOptions = state.connectors
    .filter((item) => item.role === "CONSUMER")
    .map((item) => `<option value="${item.connectorId}">${item.name}</option>`)
    .join("");

  el("fileOwnerSelect").innerHTML = allOptions;
  el("publishProviderSelect").innerHTML = providerOptions;
  el("consumerSelect").innerHTML = consumerOptions;
  renderConnectorFiles();
}

function renderConnectorFiles() {
  const owner = selectedConnector("fileOwnerSelect");
  const publisher = selectedConnector("publishProviderSelect");
  const ownerFiles = owner?.ownedFiles || [];
  const publishFiles = (publisher?.ownedFiles || []).filter((file) => file.origin === "LOCAL_UPLOAD");

  el("connectorFilesList").innerHTML =
    ownerFiles
      .map(
        (file) => `
          <div class="item">
            <div class="item-title">
              <span>${file.fileName}</span>
              ${statusPill(file.status)}
            </div>
            <p class="muted">大小：${file.fileSize} bytes · 来源：${file.origin}</p>
            <p class="muted">路径：${file.localPath}</p>
          </div>
        `
      )
      .join("") || '<p class="muted">该 Connector 目录暂时为空。</p>';

  el("connectorFileSelect").innerHTML = publishFiles
    .map((file) => `<option value="${file.connectorFileId}">${file.fileName} · ${file.status}</option>`)
    .join("");
}

function renderResources() {
  const fileResources = state.resources.filter((item) => item.resourceType === "FILE");
  el("resourceSelect").innerHTML = fileResources
    .map((item) => `<option value="${item.resourceId}">${item.name} · ${item.resourceId}</option>`)
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

async function main() {
  el("notifyCloseBtn").addEventListener("click", closeNotice);
  el("notifyOverlay").addEventListener("click", (event) => {
    if (event.target === el("notifyOverlay")) {
      closeNotice();
    }
  });

  el("initBtn").addEventListener("click", async () => {
    const confirmed = window.confirm(
      "确定要重置演示系统吗？\n\n该操作会删除数据库中的 Connector、资源、密钥、日志记录，并清空本地上传文件和系统加密文件。"
    );
    if (!confirmed) {
      showNotice("warning", "已取消重置", "系统数据没有被修改。");
      return;
    }
    await runAction({
      successTitle: "重置完成",
      successMessage: "已删除所有 Connector、系统资源、密钥、日志、上传文件和本地目录文件。",
      resultTarget: el("fileImportResult"),
      action: () => api("/api/system/init", { method: "POST", body: {} })
    });
  });

  el("registerBtn").addEventListener("click", async () => {
    await runAction({
      successTitle: "Connector 添加成功",
      successMessage: "Connector 已注册，证书、属性和 ABE 用户密钥已生成。",
      resultTarget: el("fileImportResult"),
      action: () =>
        api("/api/connectors/register", {
          method: "POST",
          body: {
            name: el("connectorName").value,
            role: el("connectorRole").value,
            attributes: splitAttrs(el("connectorAttrs").value)
          }
        })
    });
  });

  el("fileOwnerSelect").addEventListener("change", renderConnectorFiles);
  el("publishProviderSelect").addEventListener("change", renderConnectorFiles);

  el("importFileBtn").addEventListener("click", async () => {
    const connector = selectedConnector("fileOwnerSelect");
    const file = el("fileInput").files[0];
    if (!connector || !file) {
      showNotice("warning", "缺少必要信息", "请先选择 Connector 和本地文件。");
      return;
    }
    await runAction({
      successTitle: "文件导入成功",
      successMessage: "文件已写入该 Connector 的本地目录，下一步可以由 Provider 发布到系统。",
      resultTarget: el("fileImportResult"),
      action: async () => {
        const contentBase64 = await fileToBase64(file);
        return api(`/api/connectors/${connector.connectorId}/files/import`, {
          method: "POST",
          body: {
            fileName: file.name,
            mimeType: file.type || "application/octet-stream",
            contentBase64
          }
        });
      }
    });
  });

  el("publishFileBtn").addEventListener("click", async () => {
    const provider = selectedConnector("publishProviderSelect");
    const connectorFileId = el("connectorFileSelect").value;
    if (!provider || !connectorFileId) {
      showNotice("warning", "缺少必要信息", "请先选择 Provider 和它目录中的文件。");
      return;
    }
    await runAction({
      successTitle: "文件发布成功",
      successMessage: "文件已加密保存为系统资源，DEK 已受访问策略保护。",
      resultTarget: el("filePublishResult"),
      action: () =>
        api("/api/files/publish", {
          method: "POST",
          body: {
            providerConnectorId: provider.connectorId,
            connectorFileId,
            abePolicy: el("filePolicyInput").value
          }
        })
    });
  });

  el("fileDownloadBtn").addEventListener("click", async () => {
    const resource = selectedResource();
    const consumer = selectedConnector("consumerSelect");
    if (!resource || !consumer) {
      showNotice("warning", "缺少必要信息", "请先选择 Consumer 和系统文件资源。");
      return;
    }
    await runAction({
      successTitle: "文件下载成功",
      successMessage: "属性策略校验通过，文件已解密并写入 Consumer 本地目录。",
      resultTarget: el("downloadResult"),
      action: () =>
        api("/api/files/download", {
          method: "POST",
          body: {
            consumerConnectorId: consumer.connectorId,
            resourceId: resource.resourceId
          }
        }),
      onSuccess: async (data) => {
        if (data.result === "SUCCESS") {
          downloadBase64File(data.fileName, data.mimeType, data.contentBase64);
        }
      }
    });
  });

  el("setSalesBtn").addEventListener("click", async () => {
    const consumer = selectedConnector("consumerSelect");
    if (!consumer) {
      showNotice("warning", "缺少必要信息", "请先选择 Consumer。");
      return;
    }
    await runAction({
      successTitle: "属性修改成功",
      successMessage: "Consumer 已切换为销售属性，旧 ABE 用户密钥已撤销并重发。",
      resultTarget: el("downloadResult"),
      action: () =>
        api(`/api/connectors/${consumer.connectorId}/attributes`, {
          method: "PUT",
          body: { attributes: ["department=sales", "role=researcher"] }
        })
    });
  });

  el("setRdBtn").addEventListener("click", async () => {
    const consumer = selectedConnector("consumerSelect");
    if (!consumer) {
      showNotice("warning", "缺少必要信息", "请先选择 Consumer。");
      return;
    }
    await runAction({
      successTitle: "属性恢复成功",
      successMessage: "Consumer 已恢复研发属性，可以再次测试访问策略。",
      resultTarget: el("downloadResult"),
      action: () =>
        api(`/api/connectors/${consumer.connectorId}/attributes`, {
          method: "PUT",
          body: { attributes: ["department=rd", "role=researcher"] }
        })
    });
  });

  el("rekeyBtn").addEventListener("click", async () => {
    const resource = selectedResource();
    if (!resource) {
      showNotice("warning", "缺少必要信息", "请先选择一个系统文件资源。");
      return;
    }
    await runAction({
      successTitle: "资源重加密成功",
      successMessage: "系统已生成新 DEK，并使用新 DEK 重新加密资源。",
      resultTarget: el("downloadResult"),
      action: () => api(`/api/data/resources/${resource.resourceId}/rekey`, { method: "POST", body: {} })
    });
  });

  el("revokeDekBtn").addEventListener("click", async () => {
    const resource = selectedResource();
    if (!resource) {
      showNotice("warning", "缺少必要信息", "请先选择一个系统文件资源。");
      return;
    }
    await runAction({
      successTitle: "DEK 撤销成功",
      successMessage: "当前资源 DEK 已撤销，再次下载应返回 DEK_REVOKED。",
      resultTarget: el("downloadResult"),
      action: () => api(`/api/keys/${resource.dekKeyId}/revoke`, { method: "POST", body: {} })
    });
  });

  document.querySelectorAll('[data-action="refresh"]').forEach((button) => {
    button.addEventListener("click", async () => {
      await runAction({
        successTitle: "刷新完成",
        successMessage: "页面状态已更新。",
        action: refresh
      });
    });
  });

  try {
    await refresh();
  } catch (error) {
    const friendly = explainError(error);
    showNotice("error", friendly.title, friendly.message, friendly.details);
  }
}

main().catch((error) => {
  const friendly = explainError(error);
  showNotice("error", friendly.title, friendly.message, friendly.details);
});
