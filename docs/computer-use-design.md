# Lumos 电脑操控能力 — 开发方案（交接文档）

对应 GitHub issue **#18**：让 Lumos 在用户明确授权下操控本机电脑、操作第三方桌面软件。

> **这份文档给 Windows 上的开发会话用。** 选型、渠道实测、踩坑都已在 macOS 侧做完，照此执行即可，**不用重新调研**。关键前提全部实测验证过（见 §11 证据存档）。开发前先读 §3 命门约束和 §6 坑清单。

---

## 1. 需求（#18）

用户显式授权后，Lumos 能看屏幕、开应用、点击/输入/快捷键、读界面状态，操作 AdsPower 客户端、网盘客户端、Office 桌面端、文件管理器、ERP 等**本机真实软件**。默认关闭；高风险动作二次确认；全程可中断、可审计。

---

## 2. 运行环境（已确认）

- 目标机：**Windows**（zh-CN）。
- Lumos：Electron + Next.js + Node，纯 JS，走 **Claude Agent SDK（`query()`）+ MCP** 调模型。
- 用户模型渠道：中转 `code.newcli.com/claude`，`auth_mode=local_auth`（key 注入为 `ANTHROPIC_AUTH_TOKEN` → `Authorization: Bearer`），反代 Claude Code OAuth 渠道，**只认带 `claude-cli` UA 的请求**。

---

## 3. 命门约束（决定方案，已实测）& 为什么否决「方案 A」

**方案 A（用 Anthropic 官方 computer use 工具 `computer_20251124`）已否决，别再走：**

- 实测该中转：带 `anthropic-beta: computer-use-2025-11-24` + `computer_20251124` 工具 → 上游报错，并列出它支持的工具清单：`bash / code_execution / text_editor / memory / tool_search / web_fetch / web_search / custom`——**唯独无 `computer`**。
- 即该渠道（Claude Code OAuth 反代）上游**不开放 computer use**，**非 Lumos 代码可绕过**。用户**只有中转、无 Anthropic 官方 key**。
- → computer use beta 这条路是死结。**采纳方案必须只用渠道已支持的能力。**

**渠道已支持（实测通过，方案据此设计）**：`vision`（传图）+ `custom tool`（自定义工具调用闭环）。

---

## 4. 采纳方案：分层桌面操控（不依赖 computer use beta）

```
主 Agent（Lumos 现有 Claude Agent SDK + 你的中转）
   │  调用工具（custom tool / 看图 vision —— 渠道实测支持）
   ▼
┌─ 受控外壳（Lumos 自建，方案重心）──────────────────────┐
│ 默认关闭 → 显式授权 → 执行前计划预览 → 高风险二次确认    │
│ → 白名单 → 随时中断 → 全量审计                          │
└──────────────┬─────────────────────────────────────────┘
   ┌───────────┼───────────────────────────┐
   ▼           ▼                           ▼
 L1 软件接口   L2 Windows-MCP(主力)        L3 视觉兜底
 (最优先,最稳) (UIAutomation 控件树,非视觉) (a11y 抓不到时)
 AdsPower(走    19 个工具:启动/点击/输入/    use_vision 截图
 browser-       快捷键/读窗口快照/PowerShell  + 自定义动作工具
 provider)、    /文件/剪贴板/进程/注册表      ;UI-TARS @ui-tars
 Office(office  纯文本 LLM 即可驱动           /sdk 的 operator
 -docs MCP)、                                + action-parser
 浏览器(CDP)、                                可借现成轮子
 文件(fs)
```

**分工**：现成项目出「手」（操控能力），**Lumos 出「受控外壳」**（默认关闭/确认/审计/白名单——这些现成项目都不带，是 Lumos 的核心价值）。

**驱动闭环已验证**：Windows-MCP 是纯 MCP 工具 server、**不挑模型不自带模型**；模型由 Lumos 主 Agent 用现有中转接，渠道实测支持 custom tool（调工具）+ vision（开 `use_vision` 兜底）。**不卡渠道。**

---

## 5. 选型：Windows-MCP（CursorTouch）

- repo：`https://github.com/CursorTouch/Windows-MCP` ｜ **MIT** ｜ ⭐5.9k / 33 contributors ｜ 每月发版（v0.8.2, 2026-06）｜ 标准 **stdio MCP**，Windows 7–11。
- 路线：**Windows UIAutomation 控件树（非视觉，任意纯文本 LLM 可驱动）**，正好绕开渠道缺的 computer use + 不强依赖 vision。
- 工具（19）：`Click/Type/Scroll/Move/Shortcut/Wait/WaitFor/Screenshot/Snapshot/App/PowerShell/FileSystem/Scrape/MultiSelect/MultiEdit/Clipboard/Process/Notification/Registry`。
- 浏览器：`use_dom=True`（Chrome/Edge/Firefox，UIA 或 IAccessible2）。视觉兜底：`use_vision=True`。

**否决的备选**：UI-TARS-desktop（Apache-2.0，TS/Electron 同栈，但强项 grounding 要 UI-TARS 专用模型；其 `@ui-tars/sdk` 的执行端+动作解析可在 L3 借用）；coasty/open-computer-use（锁自家端点，排除）；Agent-S（Python，备选）。

---

## 6. 已知的坑（开发必读，逐个 + 缓解）

| # | 坑 | 严重度 | 缓解 |
|---|----|--------|------|
| 1 | **Python 运行时依赖**（Python 3.13+ / uv / uiautomation）。Lumos 是纯 Node、零系统依赖、可打包——接它要在 Windows 备 Python 环境 | 🟡 最大成本 | 打包随附 or 首次引导安装；MCP command 指向 uv 运行时 |
| 2 | **Electron 启动不继承 PATH**（MSIX 沙箱）。Lumos 起这个 Python MCP 必须用 **uvx.exe 绝对路径** | 🟡 | mcp 配置写绝对路径，别靠 PATH |
| 3 | **a11y 抓不到的控件**（表格单元格 #29、Electron/自定义 UI 内部） | 🟢 有兜底 | 退 `use_vision=True`（渠道 vision 实测支持）或浏览器 `use_dom` |
| 4 | **UAC / 管理员权限**：管理员级应用、UAC 弹窗会卡；RDP/无人值守受限 | 🟡 | 受控外壳里显式提示；高完整性应用需 MCP 进程提权 |
| 5 | **中文 Windows 的 App-Tool**（启动应用工具默认要英文系统语言） | 🟢 | 用其余工具或 PowerShell 启动；该工具可禁用 |
| 6 | **它只给裸操控，无受控闸门** | 🔴 必补 | 默认关闭/确认/审计/白名单全靠 Lumos（§7） |
| 7 | **Snapshot token 开销**：复杂窗口控件树可能大 | 🟢 | 它只返回可交互元素 id（已裁剪）；实测真实窗口大小 |
| 8 | 动作间延迟 1.5–2.3s | 🟢 | 可接受（人在环路本不要求毫秒级） |

**最大不确定点（文档保证不了，必须实测）**：你的真实目标软件——尤其 **AdsPower 客户端（很可能是 Electron）**——控件树能被抓到什么程度。抓得到用 a11y（快/准/省 token），抓不到退 `use_vision`。**先对真实软件裸测再集成。**

---

## 7. Lumos 落地点（真实文件，开发参照）

- **MCP 接入**：`public/mcp-servers/windows-mcp.json`（声明 command=uvx 绝对路径 / args / env）+ `src/lib/mcp-resolver.ts`（占位符解析）+ `src/lib/init-builtin-resources.ts`（默认启用列表）。参照「内置 MCP 开发规范」，但本项是**外部 Python MCP**，非自写 `.mjs`，按第三方 MCP 形态接。
- **受控外壳**：
  - 工具闸门：`src/lib/team-run/runtime-tool-policy.ts` 的 `canUseTool` 当前对所有工具 **allow**——桌面操控工具必须在此**改为高风险确认**，不能放行裸点击/输入。
  - 草稿后确认：复用 `src/lib/app/native-automation-runner.ts` / native-app 草稿确认骨架。
  - 审计：新增 `computer_use_audit` 表（动作/时间/目标窗口/截图/结果），UI 可查。
- **L1 复用**：AdsPower **走 `browser-provider` 抽象，不直接调 AdsPower API**（见平台级浏览器管理约束）；Office 用现有 office-docs MCP；浏览器用现有 CDP。
- **执行端原生依赖**（仅 L3 自建视觉路径需要）：截屏用 Electron `desktopCapturer`（零依赖）；鼠标键盘注入评估借 `@ui-tars/operator-nut-js`，注意 nut.js 供应链风险。
- **UI**：控制面板（实时状态 + 动作计划 + 确认/中断 + 审计列表）+ 设置开关 + IM 通知。可见性参照内置级应用要求（状态/设置/审计/失败原因都要可见，缺底层能力显示 `未接入/需授权/失败原因`，不 mock 冒充）。

---

## 8. 开发里程碑（Windows 会话照做；终态三层都要，非阉割交付）

- **M0 裸测**（先验证最大不确定点）：Windows 装 Python 3.13+/uv → `uvx windows-mcp serve` → 用一个 MCP 客户端或直连，对**记事本 + AdsPower 客户端**测 Snapshot/Click/Type，确认 a11y 覆盖度；抓不到的开 `use_vision` 看效果。**这步不通过，先别集成。**
- **M1 接入 Lumos**：把 Windows-MCP 配成 Lumos 的 MCP（uvx 绝对路径），主 Agent 能列出/调用其工具，跑通一个真实动作。
- **M2 受控外壳**：`canUseTool` 闸门 + 默认关闭开关 + 执行前计划预览 + 高风险二次确认 + 白名单 + 中断 + 审计落库。
- **M3 视觉兜底**：a11y 抓不到的软件走 `use_vision`（渠道 vision 已验证）。
- **M4 控制面 UI + IM 通知 + 设置页**。
- **M5 验收**：按 §9 + §6 坑逐条过。
- **M6 Python 运行时分发**：打包随附 or 首次引导安装，解决坑 #1/#2。

---

## 9. 验收（对应 #18 七条）

- [ ] 设置中显式开/关「电脑操控模式」，**默认关闭**，未授权不可截屏/操作。
- [ ] 执行前展示动作计划并请求确认。
- [ ] 能执行基础动作：打开应用、点击、输入、快捷键、文件选择、窗口切换。
- [ ] 删文件/付款/发消息/上传隐私/提交表单等高风险动作**强制二次确认**。
- [ ] 所有动作有可查审计记录。
- [ ] 可随时中断正在执行的任务。
- [ ] 能力默认关闭，未授权不能读屏或操作。

---

## 10. 红线 / 待决（须用户拍板）

1. **加原生依赖**：L3 视觉路径的鼠标键盘注入（@ui-tars/operator-nut-js 或自写 N-API）。— 加依赖红线。
2. **Python 运行时分发**：随包打包还是引导安装？影响安装体积与首启体验。
3. **本机无隔离的固有风险**：控本机即放弃 Anthropic 建议的 VM 隔离，靠白名单+确认+审计补偿，**需用户知情同意**。

---

## 11. 实测证据存档（macOS 侧已验，Windows 会话可直接信任）

渠道 = `code.newcli.com/claude`，鉴权 `Authorization: Bearer`（local_auth/ANTHROPIC_AUTH_TOKEN），需带 `claude-cli` UA：

| 测试 | 请求 | 结果 | 结论 |
|------|------|------|------|
| computer use | `computer_20251124` + beta header | 400，工具清单**无 computer** | ❌ 方案 A 死结 |
| 普通请求 | 无 UA | 400「暂不支持」 | 中转校验 UA |
| 普通请求 | 带 claude-cli UA | 200，返回 OK | 鉴权 OK，仅认 CLI 形态 |
| **vision** | 传纯蓝图问主色 | 200，答 **Blue** | ✅ 渠道支持看图 |
| **custom tool** | 定义 click 工具 + tool_choice:any | 200，返回 `tool_use: click{x:100,y:200}` | ✅ 渠道支持自定义工具闭环 |

> key 全程走 600 权限临时文件、用完即删，未入 argv / 未明文输出 / 未入 git。

---

## 12. 严格口径

当前仅完成**方案设计（本文档）**：文档完整度＝部分完成；主链状态＝未打通（受控外壳/MCP 接入/UI 均未落地）。不得据此宣称能力可用。
