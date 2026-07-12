# 可信数据空间密钥管理与加密演示系统：CP-ABE 混合加密方案设计

## 1. 文档目标

本文档对应方案设计的第三阶段：重点设计 CP-ABE 加密模型。

本文在前两份文档基础上，专门回答以下问题：

1. 为什么采用 `CP-ABE + 对称加密` 的混合加密方案。
2. AES 数据密钥 DEK 由谁生成、谁保存、如何被保护。
3. ABE 系统密钥和属性密钥由谁生成、如何分发、如何撤销。
4. Connector 如何基于证书和属性获得访问权限。
5. 属性变化后如何实现权限更新。
6. Demo 中真实密码实现和演示型实现之间如何解耦。

## 2. 混合加密总体模型

可信数据空间中的数据可能是文本、文件、表格、模型或计算结果。直接使用 CP-ABE 加密完整数据效率较低，也不适合大数据对象。

因此 Demo 采用混合加密：

```text
数据本体 -> AES-GCM 加密
AES 数据密钥 DEK -> CP-ABE 按访问策略加密
```

整体结构：

```text
Plaintext Data
  │
  │ 1. KMS 生成随机 DEK
  ▼
DEK ────────────────┐
  │                 │
  │ 2. AES-GCM       │ 3. CP-ABE(policy)
  ▼                 ▼
Encrypted Data   Encrypted DEK
  │                 │
  └──────┬──────────┘
         ▼
Data Package = {
  ciphertext,
  encrypted_dek,
  policy,
  metadata
}
```

访问时：

```text
Connector Attributes
  │
  │ 1. AA 生成 ABE 用户属性私钥
  ▼
ABE User Secret Key
  │
  │ 2. ABE 解密 encrypted_dek
  ▼
DEK
  │
  │ 3. AES-GCM 解密 ciphertext
  ▼
Plaintext Data
```

## 3. 角色与职责

| 角色 | 与加密相关的职责 |
| --- | --- |
| Connector A | 数据提供方，提交明文数据和访问策略。 |
| Connector B | 数据使用方，提交访问请求，使用属性密钥解密。 |
| Platform | 编排数据发布和访问流程，保存资源元数据和访问策略。 |
| KMS | 生成 DEK，管理 DEK 元数据和生命周期。 |
| Attribute Authority | 管理属性，生成 ABE 系统密钥和 ABE 用户属性密钥。 |
| Crypto Engine | 执行 AES-GCM、CP-ABE 加密和解密。 |
| CA | 保证 Connector 身份可信，但不参与数据加密计算。 |

## 4. 密钥分类

### 4.1 身份密钥

身份密钥由 Connector 生成，用于证书申请和身份签名。

```text
connector_identity_keypair = (
  connector_public_key,
  connector_private_key_ref
)
```

Demo 中可以模拟为字符串或伪密钥，不要求真实 RSA/ECC。

### 4.2 CA 根密钥

CA 根密钥用于签发 Connector 证书。

```text
ca_root_private_key
ca_root_public_key
```

Demo 中 CA 根私钥不暴露，只返回证书和证书状态。

### 4.3 KMS 主密钥

KMS 主密钥用于保护或标记下级密钥。

```text
kms_master_key
```

第一版 Demo 可以不真实使用主密钥加密 DEK，但应记录 `parent_key_id`，体现层级关系。

### 4.4 数据加密密钥 DEK

DEK 是每份数据资源的随机 AES 密钥。

```text
dek = Random(256 bit)
algorithm = AES-256-GCM
```

DEK 的明文生命周期：

```text
生成 -> AES 加密数据 -> CP-ABE 加密 DEK -> 清理明文 DEK
```

Demo 存储中不保存明文 DEK，只保存：

- `encrypted_dek`
- `dek_key_id`
- `key_version`
- `key_status`

### 4.5 ABE 系统密钥

由 Attribute Authority 初始化。

```text
abe_public_key
abe_master_secret_key
```

其中：

- `abe_public_key` 可公开给加密方。
- `abe_master_secret_key` 仅由 AA 持有，用于生成属性私钥。

### 4.6 ABE 用户属性密钥

由 AA 根据 Connector 当前属性集合生成。

```text
abe_user_secret_key = KeyGen(
  abe_public_key,
  abe_master_secret_key,
  connector_attributes
)
```

它绑定的是属性集合，而不是某个资源。

## 5. 访问策略模型

访问策略由数据提供方 Connector A 在发布数据时定义。

第一版 Demo 建议支持如下表达式：

```text
department=rd AND role=researcher
department=rd OR role=auditor
(department=rd AND level=3) OR role=admin
```

策略语义：

```text
policy = BooleanExpression(attribute predicates)
```

属性谓词第一版只做等值判断：

```text
key=value
```

后续可扩展：

- 数值比较：`level >= 3`
- 时间属性：`valid_month=2026-07`
- 用途约束：`purpose=research`
- 数据空间约束：`space=space-a`

## 6. 加密数据包结构

数据发布后生成一个数据包：

```json
{
  "resource_id": "resource-001",
  "provider_connector_id": "conn-a",
  "ciphertext": "base64-aes-gcm-ciphertext",
  "encrypted_dek": "base64-cpabe-ciphertext",
  "abe_policy": "department=rd AND role=researcher",
  "dek_key_id": "key-dek-001",
  "key_version": 1,
  "encryption_algorithm": "AES-256-GCM",
  "abe_algorithm": "CP-ABE-DEMO",
  "metadata": {
    "iv": "base64-iv",
    "tag": "included-in-ciphertext-or-separate",
    "created_at": "2026-07-08T13:00:00"
  }
}
```

### 6.1 AES-GCM 密文结构

推荐结构：

```text
base64(iv || ciphertext || tag)
```

或结构化保存：

```json
{
  "iv": "base64",
  "ciphertext": "base64",
  "tag": "base64"
}
```

为了前端展示清晰，Demo 可以使用结构化保存。

### 6.2 CP-ABE 加密 DEK 结构

演示型 CP-ABE 密文建议结构：

```json
{
  "abe_ciphertext_id": "abe-cph-001",
  "algorithm": "CP-ABE-DEMO",
  "policy": "department=rd AND role=researcher",
  "wrapped_dek": "base64",
  "policy_hash": "sha256(policy)",
  "created_at": "2026-07-08T13:00:00"
}
```

如果接入真实 ABE 服务，则 `wrapped_dek` 替换为真实 ABE 密文字节的 Base64。

## 7. 数据发布加密流程

### 7.1 输入

```json
{
  "provider_connector_id": "conn-a",
  "name": "demo-data",
  "plaintext": "需要保护的数据",
  "abe_policy": "department=rd AND role=researcher"
}
```

### 7.2 前置条件

```text
Connector A 已注册
Connector A 证书有效
KMS 已初始化
AA 已初始化
策略语法合法
```

### 7.3 详细步骤

```text
1. Platform 接收数据发布请求。
2. Platform 调用 CA 验证 Connector A 的证书状态。
3. Platform 检查 Connector A 状态为 REGISTERED。
4. Platform 调用 Policy Parser 校验 abe_policy。
5. KMS 生成 DEK:
   dek_key_id = key-dek-001
   dek = Random(256 bit)
6. Crypto Engine 执行 AES-GCM:
   ciphertext = AES_GCM_Encrypt(dek, plaintext)
7. Platform 从 AA 获取 abe_public_key。
8. Crypto Engine 执行 CP-ABE:
   encrypted_dek = CPABE_Encrypt(abe_public_key, abe_policy, dek)
9. KMS 保存 DEK 元数据:
   key_id = dek_key_id
   key_type = DATA_ENCRYPTION_KEY
   status = ACTIVE
   version = 1
10. Platform 创建资源:
    status = PUBLISHED
11. 明文 DEK 从运行时上下文清理。
12. 返回资源信息和流程步骤。
```

### 7.4 输出

```json
{
  "resource_id": "resource-001",
  "dek_key_id": "key-dek-001",
  "ciphertext_preview": "base64...",
  "encrypted_dek_preview": "base64...",
  "abe_policy": "department=rd AND role=researcher",
  "steps": [
    "PROVIDER_CERT_VERIFIED",
    "POLICY_VALIDATED",
    "DEK_GENERATED",
    "DATA_AES_ENCRYPTED",
    "DEK_CPABE_ENCRYPTED",
    "RESOURCE_PUBLISHED"
  ]
}
```

## 8. 数据访问解密流程

### 8.1 输入

```json
{
  "consumer_connector_id": "conn-b",
  "resource_id": "resource-001"
}
```

### 8.2 前置条件

```text
Connector B 已注册
Connector B 证书有效
资源已发布
DEK 状态 ACTIVE
Connector B 属性未被撤销
```

### 8.3 详细步骤

```text
1. Platform 接收访问请求。
2. Platform 查询 Connector B。
3. CA 验证 Connector B 证书。
4. Platform 查询资源 resource-001。
5. KMS 检查资源关联 dek_key_id 的状态。
6. AA 查询 Connector B 的有效属性集合。
7. Policy Engine 判断属性集合是否满足 abe_policy。
8. 如果不满足，返回 POLICY_NOT_SATISFIED。
9. AA 生成或获取 Connector B 的 ABE 用户属性私钥。
10. Crypto Engine 执行 CP-ABE 解密:
    dek = CPABE_Decrypt(abe_user_secret_key, encrypted_dek)
11. Crypto Engine 执行 AES-GCM 解密:
    plaintext = AES_GCM_Decrypt(dek, ciphertext)
12. Platform 记录访问日志。
13. 明文 DEK 从运行时上下文清理。
14. 返回明文和流程步骤。
```

### 8.4 输出：成功

```json
{
  "result": "SUCCESS",
  "plaintext": "需要保护的数据",
  "steps": [
    "CONSUMER_CERT_VERIFIED",
    "RESOURCE_FOUND",
    "DEK_STATUS_ACTIVE",
    "ATTRIBUTES_LOADED",
    "POLICY_SATISFIED",
    "ABE_USER_KEY_READY",
    "DEK_CPABE_DECRYPTED",
    "DATA_AES_DECRYPTED"
  ]
}
```

### 8.5 输出：失败

```json
{
  "result": "DENIED",
  "reason": "POLICY_NOT_SATISFIED",
  "required_policy": "department=rd AND role=researcher",
  "consumer_attributes": ["department=sales", "role=researcher"],
  "steps": [
    "CONSUMER_CERT_VERIFIED",
    "RESOURCE_FOUND",
    "ATTRIBUTES_LOADED",
    "POLICY_NOT_SATISFIED"
  ]
}
```

## 9. ABE 属性密钥生成方案

### 9.1 生成时机

ABE 用户属性密钥可以有两种生成方式：

| 模式 | 描述 | Demo 建议 |
| --- | --- | --- |
| 即时生成 | 每次访问时根据当前属性生成。 | 简单，适合第一版。 |
| 缓存生成 | 属性变化时生成并缓存。 | 适合展示密钥生命周期。 |

建议第一版同时展示缓存记录：

```text
属性更新 -> 旧 ABE key REVOKED -> 新 ABE key ACTIVE
访问时若存在 ACTIVE key，则使用；否则重新生成。
```

### 9.2 属性密钥记录

```json
{
  "key_id": "key-abe-user-001",
  "key_type": "ABE_USER_SECRET_KEY",
  "owner_id": "conn-b",
  "algorithm": "CP-ABE-DEMO",
  "attributes": ["department=rd", "role=researcher"],
  "status": "ACTIVE",
  "version": 1,
  "created_at": "2026-07-08T13:00:00"
}
```

### 9.3 属性变更后的密钥处理

当 Connector B 属性从：

```text
department=rd, role=researcher
```

变为：

```text
department=sales, role=researcher
```

处理流程：

```text
1. AA 撤销旧属性绑定 department=rd。
2. AA 新增属性绑定 department=sales。
3. 旧 ABE_USER_SECRET_KEY 状态改为 REVOKED。
4. AA 基于新属性集合生成新 ABE_USER_SECRET_KEY。
5. 后续访问必须使用新属性集合判断策略。
```

## 10. 权限更新与撤销设计

属性撤销在 ABE 系统中是复杂问题。Demo 采用分层撤销策略。

### 10.1 第一层：平台访问前检查

所有访问必须经过 Platform：

```text
Platform -> CA 检查证书
Platform -> AA 检查属性状态
Platform -> KMS 检查密钥状态
```

只要属性被撤销，即使旧密文还在，也不允许进入解密流程。

这是 Demo 默认撤销方式。

### 10.2 第二层：属性密钥撤销

旧属性集合对应的 ABE 用户密钥标记为：

```text
REVOKED
```

前端密钥管理页面展示：

```text
key-abe-user-001  REVOKED
key-abe-user-002  ACTIVE
```

### 10.3 第三层：资源重加密

对于需要强撤销的资源，执行 `rekey`：

```text
1. KMS 生成新 DEK。
2. 使用新 DEK 重新 AES 加密数据。
3. 使用当前访问策略重新 CP-ABE 加密新 DEK。
4. 旧 DEK 标记为 ROTATED 或 REVOKED。
5. 资源 key_version + 1。
```

Demo 中可提供按钮：

```text
重新加密资源 / Rekey Resource
```

## 11. CP-ABE Demo Engine 设计

为了保证项目可运行，第一版可以实现演示型 CP-ABE 引擎。

### 11.1 接口形态

```python
class CpabeEngine:
    def setup(self) -> AbeSystemKeys:
        ...

    def keygen(self, attributes: list[str]) -> AbeUserKey:
        ...

    def encrypt_dek(self, dek: bytes, policy: str) -> AbeCiphertext:
        ...

    def decrypt_dek(self, encrypted_dek: AbeCiphertext, user_key: AbeUserKey) -> bytes:
        ...
```

### 11.2 演示型实现逻辑

演示型 CP-ABE 不实现真实双线性配对，而实现相同语义：

```text
encrypt_dek:
  - 保存策略 policy
  - 使用内部 demo wrapping key 包裹 DEK
  - 输出 encrypted_dek，其中包含 policy

decrypt_dek:
  - 读取 user_key.attributes
  - 判断 attributes 是否满足 policy
  - 满足则解包 DEK
  - 不满足则拒绝
```

这样可以完整展示：

- 策略绑定到密文。
- 用户属性绑定到属性密钥。
- 属性不满足时无法得到 DEK。

### 11.3 与真实 CP-ABE 的替换点

后续替换为真实 CP-ABE 时，不应影响 Platform、KMS、AA 和前端。

替换点只在：

```text
crypto/cpabe_demo.py
```

替换为：

```text
crypto/cpabe_real.py
```

保持相同接口：

```text
setup
keygen
encrypt_dek
decrypt_dek
```

## 12. 与已有 ABE 加密服务的关系

已有 `ABE加密服务` 已经实现：

- ABE 系统初始化。
- 根据属性生成私钥。
- 按策略加密数据。
- 按用户属性解密数据。
- AES-GCM 对外接口。

本 Demo 不直接依赖它，但设计保持兼容：

| 已有 ABE 服务 | 本 Demo 映射 |
| --- | --- |
| `CryptoService.abeEncrypt` | `CpabeEngine.encrypt_dek` |
| `CryptoService.abeDecrypt` | `CpabeEngine.decrypt_dek` |
| `MemoryABE.setup` | `AttributeAuthority.initialize_abe` |
| `MemoryABE.keyGen` | `AttributeAuthority.issue_abe_user_key` |
| `AESUtil.encrypt/decrypt` | `AesEngine.encrypt/decrypt` |

后续若希望接入 Java ABE 服务，可以让 Python 后端通过 HTTP 调用：

```text
POST /api/cpabe/encrypt
POST /api/cpabe/decrypt
```

## 13. 安全说明

第一版 Demo 明确不是生产级实现。

需要在代码和文档中注明：

1. 演示型 CP-ABE 只用于流程展示，不具备真实 CP-ABE 密码安全性。
2. 真实系统必须保护 AA master secret key。
3. 真实系统不能把明文 DEK 持久化。
4. 真实系统需要 mTLS、认证鉴权、审计日志。
5. 真实系统需要更严格的属性撤销方案。
6. 真实系统应使用 HSM/KMS/Vault 保护主密钥。

## 14. 第三阶段结论

本阶段确定了 Demo 的核心密码设计：

```text
数据本体：AES-256-GCM 加密
数据密钥：KMS 生成 DEK
访问控制：CP-ABE 加密 DEK
属性密钥：AA 根据 Connector 属性生成
权限判断：Platform + AA + KMS 三方状态共同决定
撤销策略：平台检查 + 属性密钥撤销 + 可选资源 rekey
```

后续第四阶段应继续细化：

- 系统初始化流程。
- Connector 注册认证流程。
- 数据发布流程。
- 数据访问流程。
- 属性更新流程。
- 密钥生命周期流程。

