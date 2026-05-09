# 内置应用可安装化 / 应用商店可行性研究

> **范围**：能否把现有 wechat-assistant、goofish-assistant、ecommerce-assistant 这种「内置级应用」做成由用户/第三方开发并发布到应用商店的可安装包；如果做，路径是什么。
> **结论一句话**：**可以做，但不要重写现有内置应用，而是沿用现成的 React-V2 + iframe 沙箱链路扩 RPC 与 MCP 桥；新内置应用的 0.1.0 阶段全部按内置（hardcoded route + 平台原生 API）发布，等 RPC 表面积补全 + 应用商店后端就绪后再做迁移。**

---

## 1. 现状盘点

### 1.1 平台已经有的两条应用链路

| 链路 | 引擎标识 | UI 描述方式 | 运行位置 | 当前状态 |
|------|----------|-------------|----------|----------|
| 声明式 V1 | `declarative-v1` | `pages/*.json`（表/卡/表单的 JSON 描述） | 主进程 React 渲染器读 JSON 出 UI | 用作 AI 生成应用骨架 + 内置应用蓝图 |
| React V2 | `react-v2` | `pages/*.tsx`（真正的 React 组件） | iframe 沙箱 + 主进程 esbuild 编译 + 主→iframe importmap | 已有 compiler、loader、protocol、dispatcher、permission gate；可以装可以运行 |

代码定位：
- 安装器：`src/lib/app/installer/install.ts`
- 清单解析与跨文件校验：`src/lib/app/manifest/`
- 数据隔离：`src/lib/app/runtime/data-store.ts`（每行强绑 `app_id`，`lumos_app_data` 表组合主键）
- 沙箱协议：`src/lib/app/sandbox/protocol.ts`、`dispatcher.ts`、`app-loader.ts`、`compile/compiler.ts`
- 权限模型：`src/lib/app/sandbox/permissions.ts` + `installer/permissions.ts`（需用户同意才发证）
- 已有 RPC 方法：`db.* / nav.* / ai.* / workflow.* / deepsearch.* / im.notify / notify.* / storage.* / secrets.get / config.* / files.*`

### 1.2 三个内置应用的真实形态

| 维度 | wechat-assistant | goofish-assistant | ecommerce-assistant（v0.1） |
|------|------------------|-------------------|------------------------------|
| 注册位置 | 直接在 Lumos 仓库写死 React 路由 + API 路由 | 同左，且通过 `init-builtin-resources.ts` 安装一份**蓝图**到 `lumos_app_apps`（仅做数据隔离） | 同 goofish |
| UI 入口 | `src/app/apps/wechat-assistant/page.tsx` → `WeChatAssistantApp.tsx` | `/apps/goofish-assistant/page.tsx` → `GoofishAssistantApp.tsx` | `/apps/ecommerce-assistant/page.tsx` → `EcommerceAssistantApp.tsx` |
| API 路由 | `/api/apps/builtin/wechat/{ai-analysis,contacts,settings,sync,...}` 共 14 个 | `/api/apps/builtin/goofish/{status,chat}` 等 | `/api/apps/builtin/ecommerce/{status,inputs,jobs,presets,events}` 等 10 个 |
| 数据 | 复用 AppDataStore（隔离 OK） + 直接读 wechat-export 本地数据库 | 复用 AppDataStore + 直接调 `goofish/auth` 等 lib | 复用 AppDataStore + 直接调 `@/lib/image`、provider 解析 |
| 业务依赖 | wechat-export MCP、本地解密、IM 桥 | mtop、cookies、内置浏览器 | 图像 provider、Claude/OAI 文本 provider、vision |
| 安装路径 | 不走 installer | 走 `installApp()` 装蓝图 | 走 `installApp()` 装蓝图 |

**关键事实**：三个内置应用都「**用了 V1 的安装层做隔离 + 用了写死的 React 路由做 UI + 用了写死的 Next API 做后端**」，**没有任何一个真正跑在 React-V2 沙箱里**。它们的「内置」之所以是「内置」，本质就是这三段写死的代码。

### 1.3 缺口（为什么不能直接装）

把这三种应用从「平台代码」剥下来变成可安装包，会撞到下面这些缺口：

1. **UI 路径缺口**：现在的 React 组件 import 了一堆主进程内部模块（`@/lib/db`、`@/lib/goofish/...`、`@/lib/image`、`BrowserManager`），第三方包不可能 import 到这些。
2. **API 路径缺口**：`/api/apps/builtin/...` 是 Next.js 路由，第三方包没法注册自己的 Next 路由。所有读写必须走 RPC。
3. **RPC 表面积缺口**：现在 dispatcher 暴露的 RPC 只覆盖通用能力，**完全没暴露**：
   - 内置浏览器（CDP/page/cookies/截图）
   - 图像生成（generateImages）
   - 飞书/微信文档解密、X / 闲鱼平台 API
   - 直接 MCP 调用（应用现在只能间接通过 workflow → MCP）
4. **MCP 桥缺口**：应用想带自己的 MCP 服务器（拉自家平台数据）时，没有「装包就注册 MCP」的路径。
5. **打包格式缺口**：现在 `.lumos-app` 的 V2 manifest 已经支持 React 组件，但**没有声明应用商店需要的字段**（作者签名、定价、权限分级、最低 Lumos 版本、发布渠道、长描述、截图列表）。
6. **分发缺口**：完全没有「商店服务端」——目录、搜索、评分、版本检查、自动更新、付费、退款、举报。
7. **审核缺口**：没有 manifest 静态扫描、运行时行为审计、签名校验、撤销列表（CRL）。
8. **跨进程通讯缺口**：iframe 沙箱本身已经有 postMessage 协议，但**主进程的 BrowserManager / IM 桥跨进程触达 iframe 的反向通道目前只在主进程可读**，应用要订阅事件（如 IM 推送）需要 dispatcher 加 streaming 方法。

---

## 2. 三条可行路径对比

### 路径 A：纯声明式（V1）应用商店

> **思路**：只把已有的 declarative-v1 路径暴露出来当商店，应用全部用 `pages/*.json` 描述；React 自定义代码完全不允许。

| 维度 | 评价 |
|------|------|
| 工程量 | 最低（只补商店服务端 + 商店 UI） |
| 安全性 | 最高（应用根本不能跑代码） |
| 表达力 | 严重不足：连 wechat/goofish/ecommerce 的核心 UI 都做不了；只能撑 CRUD 类 SaaS |
| 三个现有内置 | 全部不能迁移，必须永远 hardcoded |
| 适用场景 | 财务台账、客户跟进等纯表单类 |

**裁定**：路径 A 是商店的「门槛 demo」，不能作为目标终态。可以作为 0.5 阶段的最小商店上线。

### 路径 B：React-V2 in iframe（推荐主路径）

> **思路**：把现有的 react-v2 沙箱当成第三方应用的运行时；扩 RPC 表面积让应用能调微信、闲鱼、图像、浏览器、IM、文件等能力；商店发的就是 V2 包。

| 维度 | 评价 |
|------|------|
| 工程量 | 中等（4-8 周补 RPC + 商店服务端） |
| 安全性 | 高（iframe 隔离 + manifest 权限 + dispatcher gate） |
| 表达力 | 高（真 React + Tailwind + lucide，全部 RPC 调主进程） |
| 三个现有内置 | 可迁移，但**不建议立即迁**；wechat/goofish 性能敏感（实时消息/会话），iframe 多一跳；先迁 ecommerce 做 PoC |
| 适用场景 | 95% 的真实业务应用 |

**裁定**：**这是商店的目标主路径**。短期内三个内置仍然 hardcoded，第三方应用走 V2 包。

### 路径 C：受信插件包（Obsidian/VS Code 风格）

> **思路**：应用包里直接放 Node.js + React 代码，host 起子进程或主进程动态 require，全部能力放开；用签名 + 审核兜底。

| 维度 | 评价 |
|------|------|
| 工程量 | 高（签名链、审核流程、撤销机制、强 ABI 协议） |
| 安全性 | 低（一个恶意包能勒索整台机器，必须靠开发者实名 + 商店审核） |
| 表达力 | 最高（任意 npm 包） |
| 三个现有内置 | 完美匹配，几乎不用改 |
| 适用场景 | 只对深度开发者开放 |

**裁定**：路径 C 适合「开发者扩展」频道，**不**适合面向普通用户的商店首发。可以作为 1.5 阶段的进阶频道（类似 Chrome 「开发者模式插件」），且**默认关闭**。

---

## 3. 推荐分阶段方案

### 阶段 0（已就位，0 天）
- 现有 V1/V2 安装链路、AppDataStore 隔离、validate-native-app 门禁、AppBuilder UI 都已经存在；三个内置应用各自跑得通。

### 阶段 1：补 RPC 表面积 + 装一个 V2 PoC（4-6 周）
1. **扩 RPC 方法**（`src/lib/app/sandbox/protocol.ts` + `dispatcher.ts` + `permissions.ts`）：
   - `image.generate`（包装 `@/lib/image.generateImages`）
   - `mcp.call`（按 manifest 声明的 MCP 白名单调指定工具，不能任意调）
   - `browser.*`（受控的页面创建/截图/读 cookies；后台模式默认）
   - `wechat.export.*`、`goofish.*`、`x.*`（垂直能力，限定特定可信开发者使用）
2. **完善 V2 manifest 字段**：作者、签名、定价、最低 Lumos 版本、发布渠道、长描述、截图列表、反馈邮箱。
3. **迁移 ecommerce-assistant 到 React-V2**：保留 hardcoded 版本不动，新建一个 `ecommerce-assistant-pkg/` 走 V2 路径，作为「装包后能用」的 PoC。
4. **验证标准**：用户能从 `应用 → 导入` 选一个 `.lumos-app` 文件，看权限弹窗，同意后装好，打开能完成「上传图 → 一键出图」全链路。

### 阶段 2：商店服务端 + 商店 UI（6-12 周）
1. **服务端**（独立项目，参考 lumos-web 部署模式）：
   - 应用目录 / 搜索 / 分类 / 详情 / 评分 / 评论
   - 包上传 / 自动校验（runs `validate-native-app` + 签名校验）
   - 版本管理（changelog、最低 Lumos 版本、灰度）
   - 开发者后台（账号、应用、统计、收入）
2. **客户端**：
   - 应用商店首页（位于 `/apps/store`）
   - 一键安装、自动更新（应用启动时检查 + 用户同意 + 后台下载）
   - 评分回流（用户评分写回服务端）
3. **签名链**：
   - 开发者私钥签 manifest + 包内容哈希
   - Lumos.io 服务端二次签名（确认通过审核）
   - 客户端校验双签名后才允许装；CRL 列表能远程拉取

### 阶段 3：商业化（3-6 个月）
- 免费 / 付费 / 订阅
- 试用期、退款窗口
- 开发者收入分成（参考 30% 平台费）
- 发票、税务

### 阶段 4（可选）：开发者频道（路径 C）
- 「开发者模式」开关，允许装未走商店的本地 ZIP / Git 仓库
- 警告标语、默认关闭、企业管理可远程禁用
- 给深度开发者用，**不**作为普通用户的入口

---

## 4. 关于三个现有内置应用的具体处置

| 应用 | 推荐处置 |
|------|----------|
| **wechat-assistant** | 永久 hardcoded。涉及 macOS/Windows 平台密钥解密、本地 SQLite 直读、性能敏感的 IM 实时同步，每条消息都跨 iframe 不现实。当成「平台一等公民」处理。 |
| **goofish-assistant** | 永久 hardcoded（理由同上：账号 cookies、mtop 接口、内置浏览器深度耦合）。 |
| **ecommerce-assistant** | 阶段 1 的 React-V2 迁移 PoC。它的能力完全在「图像 provider + Claude vision」边界内，扩出 `image.generate`、`mcp.call` 后能完整跑在 V2。**完成迁移后两个版本并存**：内置版给老用户，商店版作为模板供二次开发。 |

> **不要重写**：当下没必要为了「未来商店」就重构 wechat/goofish。短期 ROI 为负。把它们当成 Chrome 的「内置浏览器」来理解——第三方扩展跑沙箱，浏览器自己跑特权代码。

---

## 5. 必须新增的能力清单

按优先级排序：

### P0（阶段 1 必须）
- [ ] `image.generate` RPC + manifest permission（`permissions.image.generate: true`）
- [ ] `mcp.call(serverId, tool, args)` RPC + manifest permission（`permissions.mcp: ["server-id-1"]`）
- [ ] `browser.*` RPC（`open(background)`、`screenshot`、`readCookies`），强制 `LUMOS_BROWSER_BACKGROUND=1`
- [ ] manifest V2 加 `author/publisher/signature/minLumosVersion/screenshots/longDescription/feedbackUrl/privacyUrl/license`
- [ ] AppLoader 支持「从 ZIP 文件加载」（目前只从 builder artifacts 和已安装目录加载）
- [ ] 安装时校验签名（先支持「未签名 = 仅本地导入；商店包必须双签名」）

### P1（阶段 2 必须）
- [ ] 商店服务端：catalog API、上传、审核、签名、CRL
- [ ] 客户端：商店 UI、自动更新、评分回流
- [ ] 卸载链路完善（`uninstall.ts` 已有，需要清理 MCP 注册和定时任务）
- [ ] 沙箱 streaming 协议补全（`db.watch.start` 已声明但未必所有 host 实现都通）
- [ ] 应用更新冲突处理（用户数据迁移钩子）

### P2（阶段 3）
- [ ] 计费、订阅、退款
- [ ] 开发者后台、收入报表、发票
- [ ] 应用商店审核工具链（机器扫描 + 人工审核队列）

### P3（阶段 4）
- [ ] 开发者模式开关
- [ ] 远程禁用机制（ManagedConfig）

---

## 6. 风险与对策

| 风险 | 触发情景 | 对策 |
|------|----------|------|
| iframe 性能不够 | 实时聊天、大量列表渲染 | 仅特权应用走 hardcoded；普通应用走 V2；为热路径提供「批量 RPC」 |
| RPC 协议表面积爆炸 | 每接一个新业务都要加方法 | 优先走 MCP 通用桥（`mcp.call`），避免给每个垂直业务专建 RPC |
| 签名链泄漏 | 开发者私钥被盗 | CRL 远程撤销；Lumos.io 二次签名提供兜底 |
| 商店审核不及时 | 用户社群投诉某个包恶意 | CRL 加快撤销；客户端自动拉取 CRL；评分系统反馈 |
| 数据隔离失效 | 应用 A 读到应用 B 的数据 | AppDataStore 已有强隔离（组合主键），坚决不暴露跨应用查询 RPC |
| 卸载残留 | 应用走了，但 MCP/定时任务还在 | uninstall.ts 加上 cleanup 钩子；安装清单要求声明所有副作用 |
| 自动更新破坏用户数据 | 旧版本数据 schema 在新版本下无法读 | manifest 加 `dataMigrations: ["0.1.0->0.2.0"]`，运行时按版本号顺序跑 |

---

## 7. 决策清单（给项目负责人勾选）

- [ ] 是否同意：**短期不重写三个内置应用，优先扩 RPC + 装 V2 PoC**
- [ ] 是否同意：**ecommerce-assistant 作为 React-V2 PoC 候选**
- [ ] 是否同意：**商店服务端独立部署，参考 lumos-web 模式**
- [ ] 是否同意：**签名采用「开发者签 + Lumos.io 复签」双签链**
- [ ] 是否同意：**先做免费商店上线，付费能力放阶段 3**
- [ ] 是否同意：**开发者频道（路径 C）作为可选 1.5 阶段，默认关闭**

---

## 8. 参考文档

- 现状：`docs/app-platform-design.md`、`docs/app-platform-architecture.md`、`docs/app-platform-handoff.md`、`docs/app-platform-ai-builder.md`
- 已有 V2 沙箱：`src/lib/app/sandbox/`、`src/lib/app/compile/`
- 安装链路：`src/lib/app/installer/`、`src/lib/app/manifest/`
- 内置应用规范：`docs/native-app-development-guide.md`、`docs/native-app-acceptance-checklist.md`
- 商店规模可参考：Obsidian Community Plugins、VS Code Marketplace、Chrome Web Store、微信小程序开放平台
