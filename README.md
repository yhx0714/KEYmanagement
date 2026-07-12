# 可信数据空间密钥管理与加密演示系统

本项目是一个最小可运行 Demo，用于展示可信数据空间中连接器身份认证、属性授权、CP-ABE + AES 混合加密、数据访问控制和密钥生命周期管理流程。

## 1. 技术选型

- 后端：Node.js 原生 `http` 模块
- 密码模块：Node.js 原生 `crypto`
- 对称加密：AES-256-GCM
- CP-ABE：Demo 模拟引擎
- 前端：原生 HTML/CSS/JavaScript

当前实现不依赖外部 npm 包，方便直接运行和演示。

## 2. 目录结构

```text
连接器的密钥管理模型/
  backend/
    ca/                 CA 证书签发与验证模拟
    connector/          Connector 身份生成与抽象实体
    crypto/             AES-GCM 与 CP-ABE Demo 引擎
    kms/                密钥创建、撤销、销毁与轮换
    platform/           业务流程编排
    policy/             ABE 访问策略解析与判断
    storage/            内存状态存储
    utils/              ID、时间、指纹工具
    server.js           HTTP API 与静态页面服务
    test_flow.js        主流程测试脚本
  frontend/
    index.html          演示页面
    styles.css          页面样式
    app.js              前端交互逻辑
  01-技术调研与方案分析.md
  02-系统架构与形式化模型设计.md
  03-CP-ABE混合加密方案设计.md
  04-关键业务流程方案设计.md
  README.md
  package.json
```

## 3. 运行方式

进入项目目录：

```powershell
cd C:\Users\G3196\Desktop\生产实习\连接器的密钥管理模型
```

执行流程测试：

```powershell
npm test
```

启动 Demo：

```powershell
npm start
```

浏览器访问：

```text
http://localhost:3000
```

## 4. 演示流程

推荐按以下顺序演示：

1. 点击“生成演示数据”
2. 在“数据访问解密”中点击“请求访问”，观察访问成功
3. 点击“将 Consumer 改为销售属性”
4. 再次点击“请求访问”，观察 `POLICY_NOT_SATISFIED`
5. 点击“恢复研发属性”
6. 再次访问，观察恢复成功
7. 点击“资源重加密”，观察 DEK 版本变化
8. 点击“撤销当前资源 DEK”
9. 再次请求访问，观察 `DEK_REVOKED`

## 5. API 列表

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| POST | `/api/system/init` | 初始化系统 |
| POST | `/api/system/seed` | 生成演示数据 |
| GET | `/api/system/status` | 查询系统状态 |
| GET | `/api/connectors` | 查询 Connector 列表 |
| POST | `/api/connectors/register` | 注册 Connector |
| PUT | `/api/connectors/{id}/attributes` | 更新 Connector 属性 |
| GET | `/api/data/resources` | 查询资源列表 |
| POST | `/api/data/encrypt` | 加密并发布数据 |
| POST | `/api/data/decrypt` | 请求访问并解密数据 |
| POST | `/api/data/resources/{id}/rekey` | 资源重加密 |
| GET | `/api/keys` | 查询密钥列表 |
| POST | `/api/keys/{id}/revoke` | 撤销密钥 |
| POST | `/api/keys/{id}/destroy` | 销毁密钥 |
| GET | `/api/logs` | 查询流程日志 |

## 6. 安全说明

当前 CP-ABE 模块是演示实现，不是真实 CP-ABE 密码库。它保留了以下流程语义：

- 使用访问策略保护 DEK
- 使用属性集合判断是否满足访问策略
- 满足策略后恢复 DEK
- 使用 DEK 对数据进行 AES-GCM 解密
- 属性变更后撤销旧 ABE 用户密钥并签发新密钥

真实生产环境应替换为经过审计的 CP-ABE、KMS、CA、证书验证、密钥托管和硬件保护能力。
