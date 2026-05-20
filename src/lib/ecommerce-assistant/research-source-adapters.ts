/**
 * 内置数据源接线：把 web / deepsearch / douyin 三个 adapter 注册进 registry。
 *
 * 拆分自原 research-sources.ts（≤300 行硬规则）。依赖严格单向：
 * research-sources（契约/registry）← 各 adapter ← 本接线模块。本模块在底部
 * 自注册；research-runner 用 side-effect import 触发，测试经 reset 触发。
 */

import { clearRegisteredSources, registerResearchSource } from './research-sources';
import { webAdapter } from './research-source-web';
import { deepsearchAdapter } from './research-source-deepsearch';
import { douyinAdapter } from './research-source-douyin';

export function registerDefaultSources(): void {
  registerResearchSource('web', webAdapter);
  registerResearchSource('deepsearch', deepsearchAdapter);
  registerResearchSource('douyin', douyinAdapter);
}

/** 测试：清空并重注册内置源。reset 归属此处（与默认源接线同模块）。 */
export function resetRegisteredSourcesForTesting(): void {
  clearRegisteredSources();
  registerDefaultSources();
}

registerDefaultSources();
