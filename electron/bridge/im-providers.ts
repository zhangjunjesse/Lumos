/**
 * IM Provider Re-Exports for Electron Main Process
 *
 * 主进程不能用 `@/` alias，这里集中再导出 src/lib/im/providers 的 adapter 类。
 * 注意：只导出无 DB 依赖的 provider 模块；feishu 由 legacy runtime 处理，
 * 故意不导出，避免主进程意外加载 lark SDK 二次。
 */

export { WechatQClawAdapter } from '../../src/lib/im/providers/wechat-qclaw/adapter';
export { parseQClawConfig } from '../../src/lib/im/providers/wechat-qclaw/config';
