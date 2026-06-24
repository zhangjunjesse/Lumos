/**
 * mesh 子系统共享常量 —— 放最轻量模块（仅常量、无任何业务 import），
 * 供 store / run-control / route 共用，避免循环 import 和 magic string。
 */

/** 默认工作室 id。workshopId 复用 accountId 维度，故默认工作室即默认账户（现有数据零迁移归此）。 */
export const DEFAULT_WORKSHOP_ID = 'mesh_team_default'

/** 开启真盘(paper→live)必须回传的确认词——防 UI 误点 / API 误调真金白银。前后端共用。 */
export const LIVE_CONFIRM_WORD = '真盘下单'

/**
 * 用户可选的 agent 角色 —— UI 下拉 + 管家 schema + MeshAgentRole 类型的单一真源。
 * 放本无依赖模块,客户端('use client')与服务端都能引,避免多处硬编码漂移。
 * custom=零内置逻辑;leader 是团队唯一管理者,不在可选项里(不可被用户新建)。
 */
export const SELECTABLE_ROLES = ['custom', 'observe', 'decide', 'risk', 'review', 'research', 'integration'] as const
