/**
 * IM Provider Re-Exports for Electron Main Process
 *
 * 主进程不能用 `@/` alias，这里集中再导出 src/lib/im/providers 的 adapter 类。
 * Phase C 起 feishu 也由 ImRuntimeManager 统一管理（取代 legacy feishu-runtime.ts）。
 *
 * 仍然只导出无 DB 依赖的 provider 模块。providers/feishu/{adapter,config} 走的是
 * lark SDK + 内存配置；不直接读 DB（DB 操作发生在 src/lib/im 的 config-store，
 * 而 config-store 的读取在 Next.js 进程；主进程拿到的 raw config 已是 plain object）。
 */

export { WechatQClawAdapter } from '../../src/lib/im/providers/wechat-qclaw/adapter';
export { parseQClawConfig } from '../../src/lib/im/providers/wechat-qclaw/config';

export { FeishuAdapter } from '../../src/lib/im/providers/feishu/adapter';
export { parseFeishuConfig } from '../../src/lib/im/providers/feishu/config';
