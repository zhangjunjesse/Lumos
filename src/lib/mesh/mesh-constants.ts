/**
 * mesh 子系统共享常量 —— 放最轻量模块（仅常量、无任何业务 import），
 * 供 store / run-control / route 共用，避免循环 import 和 magic string。
 */

/** 默认工作室 id。workshopId 复用 accountId 维度，故默认工作室即默认账户（现有数据零迁移归此）。 */
export const DEFAULT_WORKSHOP_ID = 'mesh_team_default'
