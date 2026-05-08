# Memory v2 Self Improvement

## 目标

自我改进先不做自动自改代码，也不自动安装能力。当前阶段只做一个可验收闭环：

1. 从行动记忆里发现能力缺口。
2. 生成可展示、可管理的改进候选。
3. 用户确认后把候选交给能力生成器。
4. 能力生成器产出可安装的 Skill/MCP plan。
5. 用户应用并验证后，可把候选标记完成，系统回写一条能力记忆。

## 候选来源

候选主要来自三类 Memory v2 记录：

- `capability`：明确记录“缺少能力、需要 MCP/Skill/工具、反复手动处理”的能力账。
- `reflection`：复盘里提到失败、报错、无法调用、重复手工、需要自动化的内容。
- `task`：任务记忆里明确指出能力或工具缺口的内容。

资源类记忆不会直接变成改进候选，尤其不会把密码、token、cookie 等敏感值写入候选。候选只保存问题、证据、建议能力和来源记忆 ID。

## 状态

- `candidate`：系统发现，但用户尚未处理。
- `approved`：用户确认可以做。
- `building`：已经交给能力生成器。
- `built`：用户确认能力已安装或完成。
- `rejected`：用户拒绝。
- `failed`：生成或验证失败。

## 与能力生成器的关系

自我改进不直接写 Skill/MCP。它只负责把“为什么需要这个能力”整理成结构化 prompt，然后创建 Capability Builder 会话。

Capability Builder 继续负责：

- 判断最终应该是 Skill 还是 MCP。
- 生成 `lumos-extension-plan`。
- 通过现有 Apply 按钮安装 Skill/MCP。
- MCP 安装后走现有 smoke test。

## 安全边界

- 不自动安装。
- 不自动运行生成的 MCP。
- 不在候选、prompt、Skill、MCP 配置里写死明文凭证。
- 高风险候选会标记 `riskLevel=high`，包括登录态、服务器、token、生产权限、删除/写入等场景。
