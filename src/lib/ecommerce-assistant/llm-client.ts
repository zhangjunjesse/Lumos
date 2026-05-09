import { z } from 'zod';
import { generateObjectFromProvider } from '@/lib/text-generator';
import { resolveProviderForCapability, ProviderResolutionError } from '@/lib/provider-resolver';
import { providerSupportsCapability } from '@/lib/provider-config';
import { getProviderEffectiveDefaultModel } from '@/lib/claude/provider-env';
import { getProviderModelOptions, BUILTIN_CLAUDE_MODEL_IDS } from '@/lib/model-metadata';
import type { ApiProvider } from '@/types';
import type { ZodType } from 'zod';

import {
  ProductBrief,
  CutoutQc,
  FinalQc,
  ScoreReport,
  DirectionPlan,
} from './types';

export class EcommerceLlmUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EcommerceLlmUnavailableError';
  }
}

function resolveAnalysisProvider(): ApiProvider {
  let provider: ApiProvider | undefined;
  try {
    provider = resolveProviderForCapability({ moduleKey: 'agent', capability: 'agent-chat' });
  } catch (err) {
    throw new EcommerceLlmUnavailableError(
      err instanceof ProviderResolutionError
        ? `电商助手分析能力不可用：${err.message}。请在「设置 → 服务商」配置一个支持文本生成的 provider。`
        : `电商助手分析能力不可用：${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!provider) {
    throw new EcommerceLlmUnavailableError(
      '电商助手分析能力不可用：未解析到默认 provider。请在「设置 → 服务商」配置一个支持文本生成的 provider。',
    );
  }
  if (!providerSupportsCapability(provider, 'text-gen')) {
    throw new EcommerceLlmUnavailableError(
      `当前默认 provider「${provider.name}」不支持文本生成；请在「设置 → 服务商」选择一个支持文本生成的 provider。`,
    );
  }
  if (provider.auth_mode === 'local_auth') {
    throw new EcommerceLlmUnavailableError(
      `Provider「${provider.name}」使用本地登录态，无法直接结构化分析；请改用 API Key 形式的 provider。`,
    );
  }
  return provider;
}

function resolveAnalysisModel(provider: ApiProvider): string {
  const effective = getProviderEffectiveDefaultModel(provider);
  if (effective) return effective;
  const options = getProviderModelOptions(provider);
  if (options.length > 0) return options[0].value;
  if (provider.api_protocol === 'anthropic-messages') return BUILTIN_CLAUDE_MODEL_IDS.haiku;
  throw new EcommerceLlmUnavailableError(
    `Provider「${provider.name}」未配置可用模型，请先在 provider 设置中加上一个模型。`,
  );
}

interface AnalyzeArgs<T> {
  schema: ZodType<T>;
  system: string;
  prompt: string;
  imagePaths?: string[];
  abortSignal?: AbortSignal;
  maxTokens?: number;
}

async function generateStructured<T>(args: AnalyzeArgs<T>): Promise<T> {
  const provider = resolveAnalysisProvider();
  const model = resolveAnalysisModel(provider);
  return generateObjectFromProvider({
    providerId: provider.id,
    model,
    system: args.system,
    prompt: args.prompt,
    schema: args.schema,
    images: args.imagePaths?.map((p, idx) => ({ path: p, label: `Image ${idx + 1}` })),
    maxTokens: args.maxTokens ?? 2048,
    temperature: 0.2,
    abortSignal: args.abortSignal,
  });
}

const productBriefSchema = z.object({
  productType: z.string(),
  categoryBucket: z.string(),
  sizeClass: z.enum(['small', 'medium', 'large']).default('medium'),
  channelGoal: z.literal('marketplace_hero').default('marketplace_hero'),
  coreSellingPoints: z.array(z.string()).default([]),
  targetAudience: z.array(z.string()).default([]),
  recommendedUsageScenes: z.array(z.string()).default([]),
  recommendedPlacement: z.array(z.string()).default([]),
  recommendedSurfaceType: z.string().default('clean tabletop or floor-adjacent surface'),
  recommendedShotType: z
    .enum(['packshot', 'tabletop', 'room_scene', 'hero_closeup'])
    .default('tabletop'),
  recommendedLighting: z.string().default('soft natural light'),
  recommendedCameraAngle: z.string().default('45-degree front angle'),
  recommendedLensStyle: z
    .string()
    .default('50mm commercial product photography look'),
  recommendedDepthOfField: z
    .enum(['deep', 'moderate', 'shallow'])
    .default('moderate'),
  recommendedShadowStyle: z
    .enum(['soft_natural', 'crisp_controlled', 'diffused'])
    .default('soft_natural'),
  recommendedColorTemperature: z
    .enum(['warm', 'neutral', 'cool'])
    .default('neutral'),
  recommendedAspectRatio: z.string().default('4:5'),
  recommendedSceneComplexity: z
    .enum(['minimal', 'moderate', 'rich'])
    .default('minimal'),
  occlusionTolerance: z.enum(['none', 'low']).default('none'),
  humanPresencePolicy: z
    .enum(['forbidden', 'optional', 'required'])
    .default('forbidden'),
  petPresencePolicy: z
    .enum(['forbidden', 'optional', 'required'])
    .default('forbidden'),
  styleDirection: z.array(z.string()).default([]),
  avoidElements: z.array(z.string()).default([]),
  fidelityFocus: z.array(z.string()).default([]),
  consistencyAnchors: z.array(z.string()).default([]),
  confidence: z.number().int().min(0).max(10).default(5),
});

export async function identifyProductBrief(args: {
  prompt: string;
  imagePaths: string[];
  abortSignal?: AbortSignal;
}): Promise<ProductBrief> {
  const result = await generateStructured({
    schema: productBriefSchema,
    system:
      'You are a precise e-commerce analyst. Output strict JSON matching the schema. Be conservative when uncertain.',
    prompt: args.prompt,
    imagePaths: args.imagePaths,
    abortSignal: args.abortSignal,
  });
  return normalizeBrief(result);
}

function normalizeBrief(raw: ProductBrief): ProductBrief {
  const sizeClass = raw.sizeClass ?? 'medium';
  const isLarge = sizeClass === 'large';
  return {
    ...raw,
    recommendedAspectRatio: raw.recommendedAspectRatio || '4:5',
    recommendedSurfaceType:
      raw.recommendedSurfaceType ||
      (isLarge ? 'room-scale floor placement' : 'clean tabletop or floor-adjacent surface'),
    recommendedShotType: raw.recommendedShotType || (isLarge ? 'room_scene' : 'tabletop'),
    recommendedLensStyle:
      raw.recommendedLensStyle ||
      (isLarge
        ? '35mm interior commercial photography look'
        : '50mm commercial product photography look'),
    recommendedDepthOfField: raw.recommendedDepthOfField || 'moderate',
    recommendedShadowStyle: raw.recommendedShadowStyle || 'soft_natural',
    recommendedColorTemperature: raw.recommendedColorTemperature || 'neutral',
    recommendedSceneComplexity: raw.recommendedSceneComplexity || 'minimal',
    occlusionTolerance: raw.occlusionTolerance || 'none',
    humanPresencePolicy: raw.humanPresencePolicy || 'forbidden',
    petPresencePolicy: raw.petPresencePolicy || 'forbidden',
    consistencyAnchors:
      raw.consistencyAnchors && raw.consistencyAnchors.length > 0
        ? raw.consistencyAnchors
        : raw.fidelityFocus.slice(0, Math.min(6, Math.max(3, raw.fidelityFocus.length))),
  };
}

const directionPlanSchema = z.object({
  directions: z
    .array(
      z.object({
        id: z.enum(['catalog', 'lifestyle', 'campaign']),
        scene: z.string(),
        composition: z.string(),
        lighting: z.string(),
        mood: z.string(),
        negativeRules: z.array(z.string()).default([]),
      }),
    )
    .length(3),
});

export async function planDirections(args: {
  prompt: string;
  abortSignal?: AbortSignal;
}): Promise<DirectionPlan[]> {
  const result = await generateStructured({
    schema: directionPlanSchema,
    system:
      'You are a senior e-commerce art director. Output strict JSON matching the schema. Three directions must be materially different.',
    prompt: args.prompt,
    abortSignal: args.abortSignal,
  });
  return result.directions;
}

const cutoutQcSchema = z.object({
  pass: z.boolean(),
  checks: z.object({
    structure: z.enum(['pass', 'fail']),
    material: z.enum(['pass', 'fail']),
    edgeQuality: z.enum(['pass', 'fail']),
    completeness: z.enum(['pass', 'fail']),
    backgroundCleanliness: z.enum(['pass', 'fail']),
  }),
  failReason: z.string().nullable().default(null),
  retry: z.boolean().default(false),
});

export async function evaluateCutout(args: {
  prompt: string;
  imagePaths: string[];
  abortSignal?: AbortSignal;
}): Promise<CutoutQc> {
  return generateStructured({
    schema: cutoutQcSchema,
    system: 'You are a strict QC auditor. Output strict JSON matching the schema.',
    prompt: args.prompt,
    imagePaths: args.imagePaths,
    abortSignal: args.abortSignal,
  });
}

const scoreReportSchema = z.object({
  scores: z
    .array(
      z.object({
        id: z.enum(['catalog', 'lifestyle', 'campaign']),
        productFidelity: z.number().int().min(0).max(10),
        structureAccuracy: z.number().int().min(0).max(10),
        detailConsistency: z.number().int().min(0).max(10),
        sceneSuitability: z.number().int().min(0).max(10),
        compositionQuality: z.number().int().min(0).max(10),
        photographicRealism: z.number().int().min(0).max(10),
        groundingRealism: z.number().int().min(0).max(10),
        total: z.number().int(),
        hardFail: z.boolean().default(false),
        hardFailReason: z.string().nullable().default(null),
      }),
    )
    .length(3),
  winnerId: z.enum(['catalog', 'lifestyle', 'campaign', 'none']),
  winnerReason: z.string(),
  nextAction: z.enum(['final_refine', 'rerun_scene_generation']),
  needsRerun: z.boolean().default(false),
});

export async function scoreScenes(args: {
  prompt: string;
  imagePaths: string[];
  abortSignal?: AbortSignal;
}): Promise<ScoreReport> {
  return generateStructured({
    schema: scoreReportSchema,
    system: 'You are a strict e-commerce art director. Output strict JSON matching the schema.',
    prompt: args.prompt,
    imagePaths: args.imagePaths,
    abortSignal: args.abortSignal,
  });
}

const finalQcSchema = z.object({
  pass: z.boolean(),
  checks: z.object({
    structure: z.enum(['pass', 'fail']),
    proportion: z.enum(['pass', 'fail']),
    material: z.enum(['pass', 'fail']),
    details: z.enum(['pass', 'fail']),
    color: z.enum(['pass', 'fail']),
    shadow: z.enum(['pass', 'fail']),
    grounding: z.enum(['pass', 'fail']),
    photographicRealism: z.enum(['pass', 'fail']),
    backgroundCleanliness: z.enum(['pass', 'fail']),
    extraObjects: z.enum(['pass', 'fail']),
    textOrWatermark: z.enum(['pass', 'fail']),
  }),
  failReason: z.string().nullable().default(null),
  retryStage: z.enum(['scene_generation', 'final_refine', 'none']),
});

export async function evaluateFinal(args: {
  prompt: string;
  imagePaths: string[];
  abortSignal?: AbortSignal;
}): Promise<FinalQc> {
  return generateStructured({
    schema: finalQcSchema,
    system: 'You are a strict e-commerce QC auditor. Output strict JSON matching the schema.',
    prompt: args.prompt,
    imagePaths: args.imagePaths,
    abortSignal: args.abortSignal,
  });
}
