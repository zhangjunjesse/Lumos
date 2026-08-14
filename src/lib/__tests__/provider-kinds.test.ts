// provider-kinds 单一真源的奇偶校验(issue #64 的病根回归):
// 「类型档案 / 适配器注册表 / 能力判断」必须永远一致。编译期已有类型焊死,
// 这里再从运行时侧验一遍,防住"绕过类型系统注册"之类的未来漂移。

import { PROVIDER_KINDS, listImageProviderKindIds } from '../provider-kinds';
import {
  getDefaultCapabilitiesForProviderType,
  getDefaultApiProtocolForProviderType,
  providerSupportsCapability,
} from '../provider-config';
import { ensureProvidersRegistered, getRegisteredProviderTypes } from '../image/registry';

describe('provider-kinds 与消费方的奇偶校验', () => {
  it('每个 image-gen 类型都注册了适配器(#64:midjourney/openai-image 曾漏)', async () => {
    await ensureProvidersRegistered();
    const registered = new Set(getRegisteredProviderTypes());
    for (const kindId of listImageProviderKindIds()) {
      expect(registered.has(kindId)).toBe(true);
    }
  });

  it('能力默认值逐类型与档案一致(不再有第二张手写清单)', () => {
    for (const [kindId, kind] of Object.entries(PROVIDER_KINDS)) {
      expect(getDefaultCapabilitiesForProviderType(kindId)).toEqual([...kind.capabilities]);
      expect(getDefaultApiProtocolForProviderType(kindId)).toBe(kind.apiProtocol);
    }
  });

  it('未知类型回落纯文本 + anthropic-messages(与历史行为一致)', () => {
    expect(getDefaultCapabilitiesForProviderType('some-unknown-type')).toEqual(['text-gen']);
    expect(getDefaultApiProtocolForProviderType('some-unknown-type')).toBe('anthropic-messages');
  });

  it('#64 场景:capabilities 为空的 midjourney 服务商,运行时判定必须支持 image-gen', () => {
    const bareMidjourney = { capabilities: '', provider_type: 'midjourney' };
    expect(providerSupportsCapability(bareMidjourney, 'image-gen')).toBe(true);
    const bareOpenaiImage = { capabilities: '', provider_type: 'openai-image' };
    expect(providerSupportsCapability(bareOpenaiImage, 'image-gen')).toBe(true);
  });

  it('语音类型不再被判成文本(volcengine-asr-v1 曾掉默认分支)', () => {
    expect(getDefaultCapabilitiesForProviderType('volcengine-asr-v1')).toEqual(['speech']);
    expect(getDefaultCapabilitiesForProviderType('volcengine-asr-v2')).toEqual(['speech']);
  });
});
