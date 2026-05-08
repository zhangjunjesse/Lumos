# Lumos 内置级应用开发规范

这份规范用于约束 Claude / AppBuilder / 开发者开发用户侧内置级应用。目标不是生成普通可安装 demo，而是生成可打开、可配置、可运行、可验收、可迭代的 Lumos 原生应用。

## Claude 必须走的流程

1. 先明确用户可见范围
   - 用户今天能打开哪个入口。
   - 用户能配置哪些设置。
   - 用户能手动运行什么动作。
   - 用户在哪里看到运行结果、失败原因和验收证据。

2. 先写 `native-app-spec.json`
   - 覆盖状态、设置、数据、AI、自动化、IM、风险和验收清单。
   - `data.entities` 必须包含通用集合：`app_settings`、`app_automations`、`run_history`、`assistant_messages`、`app_notifications`、`app_command_runs`、`acceptance_checks`。
   - 验收清单必须包含 `installation-self-check`。

3. 使用内置级通用页面壳
   - `pages/status.json`
   - `pages/settings.json`
   - `pages/automations.json`
   - `pages/im.json`
   - `pages/run-history.json`

4. 显示缺口，不伪装完成
   - 缺外部账号、底层能力、IM、自动化或业务集成时，状态必须显示 `not_connected`、`needs_auth` 或 `failed`。
   - 不能把 mock 数据、未接入桥、未来能力说成已经可用。

5. 写操作先草稿后确认
   - AI 回复、外部发送、批量修改、删除、覆盖等写操作必须先生成草稿或待确认记录。
   - 高风险动作必须进入 `risk.highRiskActions` 或 `risk.outOfScope`。

6. 修改规格后重新确认
   - 任何 `native-app-spec.json` 变化都会让规格状态回到 `待确认`。
   - 用户必须在「项目状态」接受当前版本后，安装入口和 `install_app` 工具路径才允许继续。

7. 完成前必须跑校验
   - 在 AppBuilder 工具循环里，必须先调用 `validate_app({ nativeGrade: true, ... })`。
   - 对落盘应用包目录运行：

```bash
npm run validate:native-app -- <app-dir>
```

   - `validate_app`、`validate:native-app` 或安装门禁任一失败时，Claude 必须修复失败项，不能报告“完成”。

## 必须具备的文件

```text
app.json
routes.json
data-schema.json
native-app-spec.json
pages/status.json
pages/settings.json
pages/automations.json
pages/im.json
pages/run-history.json
```

业务页面和业务集合可以追加，但不能替代上面的通用结构。

## 强制门禁

- AppBuilder 的 `validate_app` 工具在 `nativeGrade: true` 下会检查完整内置级应用包。
- AppBuilder 的 `install_app` 工具和「保存并安装」服务端接口会再次执行同等级别检查。
- 只有 `native-app-spec.json` 合法但缺通用页面壳、运行结果、命令页、验收项或权限声明时，也不能安装。

## 状态合同

`native-app-spec.json.status.states` 至少覆盖：

- `not_configured`
- `ready`
- `running` 或 `syncing`
- `failed`
- `not_connected`

需要账号授权的应用还应使用 `needs_auth`。

## 页面合同

- 状态页必须有 `native:app:run-self-check`。
- 设置页必须包含 `ai_system_prompt` 和 `risk_note`。
- 自动化页必须包含 `native:app:run-automation` 和 `native:app:sync-automation-schedule`。
- 通知命令页必须包含 `native:app:run-command`，并说明 `/app <应用名或ID> status|runs|acceptance|help`。
- 运行结果页必须展示 `failure_reason`。

## 权限合同

- 用户生成内置级应用默认只能使用 `permissions.data = "isolated"`。
- `automations.enabled=true` 时，`app.json.permissions.system` 必须包含 `schedule`。
- `im.enabled=true` 时，`app.json.permissions.system` 必须包含 `im-notification`。
- AI、IM、自动化和外部服务都必须在 UI 中展示状态和失败原因。

## Claude 交付口径

Claude 只能说：

- `主链已打通`：用户能从 UI 完成创建、安装、打开、配置、运行、自检和查看结果。
- `完整完成`：主链打通且规格、验收清单、失败路径、权限、运行记录、真实外部能力都可验收。

如果只生成了规格、页面壳、校验和门禁，只能说 `部分完成`。
