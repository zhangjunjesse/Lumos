# DeepSearch 部署与本地使用形态设计文档

## 0. 文档定位

本文补充回答两个容易在实现前说不清的问题：

- `08 DeepSearch` 最终以什么形态部署
- 用户和开发者在本地如何实际使用它

本文不替代以下文档：

- `08-deepsearch-requirements-design.md`
- `08-deepsearch-architecture-design.md`
- `08-deepsearch-bb-browser-integration-design.md`

它的目标是把“内置在 Lumos”这句话进一步落成明确的产品与工程边界。

---

## 1. 核心结论

结论先行：

- **Phase 1 的 DeepSearch 应作为 Lumos 内置模块交付**
- **普通用户不需要单独安装一个外部 tool**
- **本地使用可以，但前提是通过本地 Lumos 实例来使用，而不是脱离 Lumos 另起一套运行时**

更具体地说：

1. 对普通用户：
   - DeepSearch 跟随 Lumos 一起构建、发布和升级
   - 用户在 Lumos 里直接打开 `扩展 -> DeepSearch` 使用
2. 对聊天与 Workflow：
   - 它们最终复用同一个 `DeepSearch Service`
   - 不直接接管 DeepSearch 自己的登录态、run 状态机和 artifact 存储
3. 对开发者：
   - 可以在本地开发模式下通过 Lumos 本体使用和调试 DeepSearch
   - 但不建议 Phase 1 先做成独立 npm 包、独立浏览器插件或独立 CLI 工具

这里还要把阶段边界说清：

- Phase 1
  - 正式交付 `DeepSearch UI + DeepSearch Service + Chat Tool Facade`
- Phase 2
  - 正式交付 `Workflow Capability Facade`
- 从 Phase 1 开始
  - 服务边界就按“未来可被 Workflow 复用”来设计

---

## 2. 为什么不是“单独安装一个 tool”

如果把 DeepSearch 先做成独立安装工具，会出现几个直接问题：

- 它需要自己解决浏览器运行时
- 它需要自己解决登录态来源
- 它需要自己解决 artifact 存储
- 它需要自己解决和 Lumos 聊天 / Workflow 的结果对齐

这会导致：

- Lumos 一套登录态
- 外部 tool 一套登录态
- 聊天 / Workflow 再包一层自己的状态映射

最终形成三套运行态。

而 `08 DeepSearch` 当前最重要的产品价值恰恰是：

- 复用 Lumos 内置浏览器共享登录态
- 用一个统一的 run / artifact / detail view 体系承接结果

所以：

- **DeepSearch 先是内置模块，不先是独立安装工具**

---

## 3. Phase 1 正式部署形态

## 3.1 产品交付形态

Phase 1 建议以以下形态交付：

- Lumos Desktop / 本地开发版内置 `DeepSearch` 功能页
- Lumos 后端内置 `DeepSearch Service`
- Lumos Electron 浏览器进程继续作为唯一正式浏览器底座

用户感知到的形态应该是：

- 安装或启动 Lumos
- 打开左侧 `扩展 -> DeepSearch`
- 检查站点登录态
- 发起抓取
- 查看历史记录和详细内容

而不应该是：

- 先去安装一个独立 `deepsearch` 插件
- 再去配置浏览器连接
- 再去想办法接回 Lumos

## 3.2 技术部署边界

建议部署边界如下：

```text
Lumos App
├── DeepSearch UI
├── DeepSearch Service
├── Site Session Manager
├── Run / Artifact Repository
├── Chat Tool Facade
├── Workflow Capability Facade (Phase 2)
└── Electron Built-in Browser Runtime
```

其中：

- `DeepSearch UI`
  - 负责独立产品入口
- `DeepSearch Service`
  - 负责正式业务主链
- `Chat Tool Facade / Workflow Capability Facade`
  - 只做复用入口，不做独立实现
- `Electron Built-in Browser Runtime`
  - 继续提供共享登录态和真实页面上下文

## 3.3 不在 Phase 1 正式部署范围内的形态

以下形态不建议作为 Phase 1 正式交付物：

- 独立 npm 包
- 独立浏览器扩展
- 独立受管浏览器
- 独立 CLI 主程序
- 直接把 `bb-browser MCP` 暴露给用户作为正式入口

原因不是不能做，而是：

- 会破坏共享登录态目标
- 会扩大产品和治理面
- 会干扰主链验证

---

## 4. 本地使用形态

## 4.1 普通用户本地使用

普通用户在本地使用 DeepSearch 的方式应当是：

1. 启动本地 Lumos
2. 打开 `扩展 -> DeepSearch`
3. 在 DeepSearch 页检查目标站点登录态
4. 在内置浏览器中完成登录
5. 回到 DeepSearch 页发起任务
6. 查看历史记录、详细内容和证据

这意味着：

- **“可以在本地使用” = 可以在本地 Lumos 里直接使用**
- **不是“可以单独把一个 tool 拿出来离线运行”**

## 4.2 开发者本地使用

开发者本地使用建议分三种方式：

### A. 产品态使用

目标：

- 以用户视角验证 DeepSearch

方式：

- 启动本地 Lumos 开发环境
- 从正式 `DeepSearch` 页面完成登录、执行、查看结果

### B. 服务态调试

目标：

- 调试 `DeepSearch Service`、run 状态机、artifact 逻辑

方式：

- 通过 Lumos 内部 API / server action / IPC 调用 service
- 仍然复用 Lumos 浏览器上下文

### C. 站点适配调试

目标：

- 调试站点 adapter、登录探针和抽取策略

方式：

- 通过 DeepSearch 自己的内部开发入口或调试面板
- 调试当前 run 绑定页面上的 adapter 执行结果
- 查看受控的 network / console / error 证据

### 不建议的开发路径

不建议开发者在 Phase 1 默认采用：

- 直接把 adapter 拿出 Lumos 单独跑
- 单独连接外部浏览器 profile 做开发
- 脱离 DeepSearch run 状态机直接调底层浏览器接口

因为这会让本地调试结果和正式产品行为脱节。

---

## 5. 安装与升级方式

## 5.1 对最终用户

安装方式应当是：

- 安装 Lumos
- DeepSearch 作为内置能力随版本一起提供

升级方式应当是：

- 升级 Lumos 版本
- DeepSearch 随主应用版本一起升级

不建议要求用户做的事情：

- 单独安装 DeepSearch 插件
- 单独安装浏览器连接器
- 单独导入 Cookie 作为主链

## 5.2 对开发环境

开发环境下，DeepSearch 的安装方式应当是：

- 跟随当前仓库代码
- 跟随本地开发环境启动

即：

- 本地拉起 Lumos 开发环境后，DeepSearch 自动可用
- 如果 DeepSearch 使用了 feature flag，也应由 Lumos 自己的配置系统控制

---

## 6. 本地运行前提

无论是普通用户还是开发者，本地运行 DeepSearch 至少需要满足：

- 本地 Lumos 可正常启动
- Electron 内置浏览器可用
- 共享浏览器 session partition 正常工作
- DeepSearch 所需的数据表 / 本地存储已初始化

对于需要登录的站点，还需要：

- 用户能在 Lumos 内置浏览器中完成登录
- DeepSearch 能在同一共享上下文中检查该站点登录态

---

## 7. 聊天与 Workflow 如何本地复用

聊天与 Workflow 在本地复用 DeepSearch 的方式应当是：

- 调用 Lumos 内部 `DeepSearch Service`
- 获取 `runId`、状态、摘要和 artifact 引用

而不是：

- 自己各自维护一套深搜流程
- 自己各自维护一套浏览器 tab 选择逻辑
- 直接转发到底层 browser bridge

建议本地复用边界：

- 聊天：
  - Phase 1 使用 `deepsearch.start / get_result / pause / resume / cancel`
- Workflow：
  - Phase 2 通过 capability facade 调用同一 service

这能保证：

- 本地调试结果一致
- 产品结果一致
- 历史记录一致

---

## 8. 后续可选的外部形态

虽然 Phase 1 不建议独立安装，但后续可以评估两类外壳：

## 8.1 Local MCP Facade

定位：

- 让外部 agent 或本地脚本以 MCP 方式调用 DeepSearch

前提：

- 底层仍然是 Lumos 内置 DeepSearch Service
- 不另起第二套浏览器运行时

## 8.2 Local CLI Facade

定位：

- 让开发者在本机用命令行触发 DeepSearch run

前提：

- CLI 只是 service 的外壳
- 不直接取代正式 UI

因此要强调：

- **MCP / CLI 可以是未来 facade**
- **但不是 Phase 1 的主产品形态**

---

## 9. 建议的本地目录与存储边界

Phase 1 建议 DeepSearch 的本地持久化继续纳入 Lumos 自身体系：

- 运行记录：沿用 Lumos DB
- 正文 / 结构化结果 / 证据：沿用 Lumos artifact 存储
- 浏览器登录态：沿用 Lumos 共享浏览器分区

不建议 Phase 1 额外引入：

- 单独的 DeepSearch 用户目录
- 单独的 DeepSearch 浏览器 profile
- 单独的外部 adapter 仓库主链

---

## 10. Phase 1 验收标准

只有满足以下条件，才能说“本地可用”：

1. 用户能在本地 Lumos 中看到正式 `DeepSearch` 页
2. 用户能在本地完成站点登录态检查与登录引导
3. 用户能在本地发起 DeepSearch run
4. 用户能在本地查看历史记录和详细内容
5. 聊天已调用同一个 `DeepSearch Service`
6. Workflow 复用边界已按同一 service 预留，不要求在 Phase 1 已正式开放

如果只是：

- 内部 service 存在
- CLI 能跑通
- 或 adapter 在调试脚本里可执行

都不能算“本地可用”。

---

## 11. 最终结论

一句话总结：

- **DeepSearch Phase 1 应内置在 Lumos 中，并可通过本地 Lumos 实例直接使用；不先做成独立安装的外部 tool。**
