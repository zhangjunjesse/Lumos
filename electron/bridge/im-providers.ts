/**
 * IM Provider Re-Exports for Electron Main Process
 *
 * 主进程不能用 `@/` alias，这里集中再导出 src/lib/im/providers 的 adapter 类。
 * 仍然只导出无 DB 依赖的 provider 模块。
 */

export { WechatAdapter } from '../../src/lib/im/providers/wechat/adapter';
export { parseWechatConfig } from '../../src/lib/im/providers/wechat/config';

export { FeishuAdapter } from '../../src/lib/im/providers/feishu/adapter';
export { parseFeishuConfig } from '../../src/lib/im/providers/feishu/config';
