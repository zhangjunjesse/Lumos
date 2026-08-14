/**
 * 服务商类型档案 —— 「某个 provider_type 是什么、会什么、默认怎么接」的**单一真源**。
 *
 * 动机(issue #64):此前"能力默认映射 / 图片适配器注册表 / UI 配置"是三张手写清单,
 * 分散在 provider-config.ts、image/registry.ts、image/provider-ui.ts,靠人肉对齐。
 * midjourney / openai-image 在适配器表里注册了、能力映射里却漏了,于是被判成纯文本
 * 服务商,按名字指定出图服务商时永远匹配不到,静默落回默认服务商。
 *
 * 现在:所有消费方(能力判断、协议默认、适配器注册、UI 配置、建档落库)都读这张表。
 * 类型层面焊死一致性 —— 新增带 image-gen 能力的类型时,若 BUILTIN_IMAGE_ADAPTERS
 * (image/registry.ts)或 imageUi 缺对应条目,**编译直接报错**,不会等到运行时掉坑。
 *
 * 不在表里的类型(未知/第三方)统一按「纯文本、anthropic-messages」处理,与历史行为一致。
 * 浏览器服务商(adspower/local-chrome 等)是另一张表(browser-providers),不在此列。
 */

import type { ProviderApiProtocol, ProviderCapability } from '@/types';

/** 图片服务商的静态 UI 档案(advancedOptions 是调用方合入的动态部分,不在档案里) */
export interface ImageKindUi {
  readonly supportedAspectRatios: readonly string[];
  readonly supportedResolutions: readonly string[];
  readonly maxCount: number;
  readonly maxReferenceImages: number;
  readonly hint?: string;
  /** true = 该类型的参数面板固定为空,忽略调用方传入的 advancedOptions(如 toapis-image) */
  readonly ignoreAdvancedOptions?: boolean;
}

export interface ProviderKind {
  readonly capabilities: readonly ProviderCapability[];
  readonly apiProtocol: ProviderApiProtocol;
  readonly imageUi?: ImageKindUi;
}

const DEFAULT_ASPECT_RATIOS = [
  '1:1', '16:9', '9:16', '3:2', '2:3', '4:3', '3:4', '4:5', '5:4', '21:9',
] as const;

const DEFAULT_RESOLUTIONS = ['1K', '2K', '4K'] as const;

export const PROVIDER_KINDS = {
  // ── 文本 / Agent 对话 ────────────────────────────────────────────────
  'anthropic': { capabilities: ['text-gen'], apiProtocol: 'anthropic-messages' },
  'custom': { capabilities: ['text-gen'], apiProtocol: 'anthropic-messages' },
  'openrouter': { capabilities: ['text-gen'], apiProtocol: 'openai-compatible' },

  // ── 图片生成 ────────────────────────────────────────────────────────
  'gemini-image': {
    capabilities: ['image-gen'],
    apiProtocol: 'openai-compatible',
    imageUi: {
      supportedAspectRatios: DEFAULT_ASPECT_RATIOS,
      supportedResolutions: DEFAULT_RESOLUTIONS,
      maxCount: 4,
      maxReferenceImages: 10,
      hint: '当前服务商走 Google 官方 Gemini 图片接口，适合通用对话式改图。',
    },
  },
  'toapis-image': {
    capabilities: ['image-gen'],
    apiProtocol: 'openai-compatible',
    imageUi: {
      supportedAspectRatios: [...DEFAULT_ASPECT_RATIOS, '1:4', '4:1', '1:8', '8:1'],
      supportedResolutions: DEFAULT_RESOLUTIONS,
      maxCount: 4,
      maxReferenceImages: 14,
      hint: '当前服务商支持极端宽高比、最多 14 张参考图，以及异步高耗时生成任务。',
      ignoreAdvancedOptions: true,
    },
  },
  'volcengine': {
    capabilities: ['image-gen'],
    apiProtocol: 'openai-compatible',
    imageUi: {
      supportedAspectRatios: DEFAULT_ASPECT_RATIOS,
      supportedResolutions: DEFAULT_RESOLUTIONS,
      maxCount: 4,
      maxReferenceImages: 4,
      hint: '当前服务商适合快速文生图，参数面板以生成质量和基础分辨率为主。',
    },
  },
  'dashscope': {
    capabilities: ['image-gen'],
    apiProtocol: 'openai-compatible',
    imageUi: {
      supportedAspectRatios: DEFAULT_ASPECT_RATIOS,
      supportedResolutions: DEFAULT_RESOLUTIONS,
      maxCount: 4,
      maxReferenceImages: 10,
      hint: '当前服务商更适合电商图像编辑、一致性组图和区域编辑。',
    },
  },
  'openai-image': {
    capabilities: ['image-gen'],
    apiProtocol: 'openai-compatible',
    imageUi: {
      supportedAspectRatios: DEFAULT_ASPECT_RATIOS,
      supportedResolutions: DEFAULT_RESOLUTIONS,
      maxCount: 4,
      maxReferenceImages: 4,
    },
  },
  'midjourney': {
    capabilities: ['image-gen'],
    apiProtocol: 'openai-compatible',
    imageUi: {
      supportedAspectRatios: DEFAULT_ASPECT_RATIOS,
      supportedResolutions: DEFAULT_RESOLUTIONS,
      // MJ 一次固定出 2×2 四宫格候选，数量设置对它不生效
      maxCount: 4,
      maxReferenceImages: 5,
      hint:
        'Midjourney 一次固定出 4 张候选（数量设置不生效），出图后可在对话里让 AI 放大、'
        + '局部重绘、抠图或转视频。注意：用本地图垫图时需要先上传，每张未缓存的图会额外消耗一次任务额度。',
    },
  },

  // ── 视频生成 ────────────────────────────────────────────────────────
  'toapis-video': { capabilities: ['video-gen'], apiProtocol: 'openai-compatible' },

  // ── 语音 ───────────────────────────────────────────────────────────
  // asr-v1 此前掉在默认分支被判成 text-gen(与 #64 同类的漏项),这里一并纠正。
  'volcengine-asr-v1': { capabilities: ['speech'], apiProtocol: 'anthropic-messages' },
  'volcengine-asr-v2': { capabilities: ['speech'], apiProtocol: 'anthropic-messages' },
} as const satisfies Record<string, ProviderKind>;

type Kinds = typeof PROVIDER_KINDS;
export type ProviderKindId = keyof Kinds;

/** 具备 image-gen 能力的类型集合(类型层面派生,不是又一张手写清单) */
export type ImageProviderKindId = {
  [K in ProviderKindId]: 'image-gen' extends Kinds[K]['capabilities'][number] ? K : never;
}[ProviderKindId];

/** 编译期校验:每个 image-gen 类型必须有 imageUi 档案,漏一个这里就报错 */
type KindsMissingImageUi = {
  [K in ImageProviderKindId]: Kinds[K]['imageUi'] extends ImageKindUi ? never : K;
}[ImageProviderKindId];
const _assertEveryImageKindHasUi: [KindsMissingImageUi] extends [never] ? true : never = true;
void _assertEveryImageKindHasUi;

export function getProviderKind(providerType: string): ProviderKind | undefined {
  return (PROVIDER_KINDS as Record<string, ProviderKind>)[providerType];
}

export function listImageProviderKindIds(): ImageProviderKindId[] {
  return (Object.keys(PROVIDER_KINDS) as ProviderKindId[]).filter(
    (id): id is ImageProviderKindId =>
      (PROVIDER_KINDS[id].capabilities as readonly string[]).includes('image-gen'),
  );
}
