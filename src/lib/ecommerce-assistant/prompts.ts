import type { DirectionPlan, ProductBrief, ScoreReport } from './types';

export const SYSTEM_PROMPT = [
  '你是 Lumos 的电商商品图工坊执行器。',
  '严格按 SOP 执行：先识别商品 brief，再做抠图（含质检），生成 3 个差异化方向的第一轮图，自动评分选最优，终版精修，终版质检；失败按回路规则降级。',
  '所有结构化输出必须严格遵循给定的 JSON Schema，不输出 markdown 代码块、解释文本或废话。',
  '不要伪造商品信息或参考图。confidence < 7 时启用保守默认。',
].join('\n');

export const BRIEF_IDENTIFY_PROMPT = `分析提供的商品图片并识别完整的电商商品 brief。
- Image 1 是商品主图。
- Images 2 ~ N（如有）是商品保真参考图。
- 不要凭空捏造图片中看不到的事实；不确定字段使用保守通用描述。
- 输出严格 JSON。

归一化规则（缺失或 confidence<7 时启用）：
- aspectRatio 缺失默认 "4:5"。
- cameraAngle 缺失默认 "45-degree front angle"。
- sceneComplexity 缺失默认 "minimal"。
- humanPresencePolicy / petPresencePolicy 缺失默认 "forbidden"。
- occlusionTolerance 缺失默认 "none"。
- surfaceType 缺失：small/medium 默认 "clean tabletop or floor-adjacent surface"，large 默认 "room-scale floor placement"。
- shotType 缺失：small/medium 默认 "tabletop"，large 默认 "room_scene"。
- lensStyle 缺失：small/medium 默认 "50mm commercial product photography look"，large 默认 "35mm interior commercial photography look"。
- depthOfField 缺失默认 "moderate"。
- shadowStyle 缺失默认 "soft_natural"。
- colorTemperature 缺失默认 "neutral"。
- consistencyAnchors 缺失则从 fidelityFocus 中选取 3~6 个最关键商品细节。`;

export function buildPlanDirectionsPrompt(brief: ProductBrief): string {
  return `基于以下商品 brief 生成 3 个差异化的电商场景方向（catalog / lifestyle / campaign）。
- 三个方向必须有实质性差异；catalog 优先干净的电商主图感；lifestyle 优先真实可信的生活场景；campaign 优先更强的视觉冲击力（不损害保真度）。
- 必须尊重 brief 中的 humanPresencePolicy 和 petPresencePolicy。
- small / medium 商品避免过大房间场景；large 商品避免狭小桌面。
- scene / composition / lighting / mood 用英文写完整摄影描述句，不要罗列关键词。

商品 brief：
${JSON.stringify(brief)}`;
}

export function buildSceneGenerationPrompt(args: {
  brief: ProductBrief;
  direction: DirectionPlan;
  fallback: boolean;
}): string {
  const fallbackBlock = args.fallback
    ? [
        '',
        'Fallback mode:',
        '- Use a simpler background.',
        '- Reduce scene complexity.',
        '- Keep more empty space around the product.',
        '- Avoid humans, pets, hands, and strong props unless strictly required by the product brief.',
        '- Prioritize product fidelity over atmosphere.',
        '- Prefer the catalog look over dramatic styling.',
      ].join('\n')
    : '';
  return [
    'Use Image 1 as the main product subject.',
    'Images 2 to N are product fidelity references.',
    '',
    'Task:',
    `Place the product from Image 1 into a ${args.direction.id} e-commerce scene.`,
    '',
    'Strict requirements:',
    '- Keep the product in Image 1 as the exact subject.',
    "- Preserve the product's shape, proportions, silhouette, perspective, material texture, seams, edges, and construction details.",
    '- Do not redesign the product.',
    '- Do not replace the product with another product.',
    '- Keep the product fully visible.',
    '- Keep the product as the clear focal point.',
    '- Do not add logos, text, labels, or watermark.',
    '- Use the supporting images only to preserve product fidelity.',
    '- Do not crop, mirror, or flip the product.',
    '- Do not let props, furniture, hands, humans, or pets block the product unless explicitly allowed by the product brief.',
    '',
    `Direction: ${args.direction.scene}`,
    `Composition: ${args.direction.composition}`,
    `Lighting: ${args.direction.lighting}`,
    `Mood: ${args.direction.mood}`,
    `Negative rules: ${args.direction.negativeRules.join('; ')}`,
    '',
    'Photography controls:',
    `- Shot type: ${args.brief.recommendedShotType}`,
    `- Camera angle: ${args.brief.recommendedCameraAngle}`,
    `- Lens style: ${args.brief.recommendedLensStyle}`,
    `- Depth of field: ${args.brief.recommendedDepthOfField}`,
    `- Shadow style: ${args.brief.recommendedShadowStyle}`,
    `- Color temperature: ${args.brief.recommendedColorTemperature}`,
    `- Consistency anchors: ${args.brief.consistencyAnchors.join(', ')}`,
    '',
    `Aspect ratio: ${args.brief.recommendedAspectRatio}.`,
    'Render a coherent photorealistic commercial scene, not a collage of visual keywords.',
    'Keep perspective, scale, light direction, and contact shadows physically plausible.',
    'High-end commercial e-commerce photography. Generate exactly one image.',
    fallbackBlock,
  ].filter(Boolean).join('\n');
}

export const CUTOUT_PROMPT = [
  'Use Image 1 as the main product subject.',
  'Use Images 2 to N only as fidelity references.',
  '',
  'Task: Remove the background and isolate the product.',
  '',
  'Strict requirements:',
  '- Keep the product from Image 1 as the exact subject.',
  '- Preserve the shape, proportions, silhouette, perspective, material texture, seams, edges, and construction details.',
  '- Do not redesign the product.',
  '- Do not change the product color.',
  '- Keep the full product visible.',
  '- Keep the original camera angle and overall framing as much as possible.',
  '- Do not add props, environment, or extra objects.',
  '- Do not add text, watermark, or logo-like graphics.',
  '- Output a clean isolated product image on a pure white background.',
  '- Add only a subtle natural grounding shadow if needed.',
  '',
  'This is a product cutout task, not a creative generation task.',
].join('\n');

export const CUTOUT_FALLBACK_HINT = [
  '',
  'Fallback mode:',
  '- Preserve the product exactly as in Image 1.',
  '- Do not stylize the product.',
  '- Keep more margin around the product.',
  '- Do not change the original angle.',
  '- Prioritize fidelity over cleanliness.',
].join('\n');

export const CUTOUT_QC_PROMPT = `对抠图结果做严格质检：将抠图与原始商品参考图对比。
- structure / material / edgeQuality / completeness 任一 fail → pass=false。
- 全部 pass → pass=true, retry=false。
- 输出严格 JSON。`;

export const FINAL_QC_PROMPT = `对终版精修图做严格质检：与抠图主图和商品参考图对比。
- structure / proportion / material / details 是阻断性检查项，任一 fail → pass=false。
- 前四项通过但 shadow / grounding / photographicRealism / backgroundCleanliness / extraObjects / textOrWatermark / color 失败 → retryStage="final_refine"。
- structure / proportion / material / details 任一失败 → retryStage="scene_generation"。
- 全部通过 → pass=true, retryStage="none"。
- 输出严格 JSON。`;

export function buildScoringPrompt(brief: ProductBrief): string {
  return `对三张第一轮场景图进行严格评分（catalog / lifestyle / campaign）。
评分维度（0-10 整数）：productFidelity、structureAccuracy、detailConsistency、sceneSuitability、compositionQuality、photographicRealism、groundingRealism。
规则：
- productFidelity / structureAccuracy / detailConsistency 权重最高；明显变形的候选不能赢。
- 两个接近时优先 productFidelity 高的。
- 任意候选若有明显变形 / 材质错误 / 比例失调 / 被遮挡 / 多余物体，hardFail=true。
- 全部弱时 winnerId="none"。
- 自动重跑判断：winnerId="none" 或最佳候选 productFidelity<8 / structureAccuracy<8 / detailConsistency<8 / photographicRealism<7 / groundingRealism<7 → needsRerun=true, nextAction="rerun_scene_generation"；否则 nextAction="final_refine"。
- 输出严格 JSON。

商品 brief：
${JSON.stringify(brief)}`;
}

export function buildFinalRefinePrompt(args: {
  brief: ProductBrief;
  scoreReport?: ScoreReport;
}): string {
  const weakAreas = args.scoreReport
    ? `针对评分弱项重点改进：${describeWeakAreas(args.scoreReport)}`
    : '保持商品本体不变，只做商业化收口。';
  return [
    'Use Image 1 as the base composition and scene direction.',
    'Use Images 2 to N as product fidelity references.',
    '',
    'Task: Refine this image into a final premium e-commerce product image.',
    '',
    'Strict requirements:',
    '- Keep the product exactly consistent with the reference product images.',
    '- Do not redesign or replace the product.',
    '- Preserve the product shape, proportions, material texture, stitching, edges, and construction details.',
    '- Keep the scene direction and composition from Image 1.',
    '- Keep the same camera angle and aspect ratio as Image 1.',
    '- Improve only the final commercial quality.',
    '- Do not widen the scene, restyle the background, or change the product-to-background scale.',
    '- Do not introduce new props, humans, hands, pets, or extra products unless they already exist in Image 1 and are required by the product brief.',
    '- Do not add text, logo, or watermark.',
    '',
    'Refinement goals:',
    '- Make the lighting cleaner and more premium.',
    '- Improve realism of shadows and product grounding.',
    '- Make the product stand out more clearly from the background.',
    '- Improve texture clarity and edge cleanliness.',
    '- Reduce visual clutter.',
    '- Keep the composition balanced and suitable for e-commerce.',
    '',
    weakAreas,
    '',
    'Style: high-end commercial e-commerce photography. Clean, realistic, premium, trustworthy. Generate exactly one image.',
  ].join('\n');
}

function describeWeakAreas(report: ScoreReport): string {
  const winner = report.scores.find((score) => score.id === report.winnerId);
  if (!winner) return '保持商品本体不变，只做商业化收口。';
  const weak: string[] = [];
  if (winner.photographicRealism < 8) weak.push('photographic realism');
  if (winner.groundingRealism < 8) weak.push('grounding realism');
  if (winner.detailConsistency < 9) weak.push('detail consistency');
  if (winner.compositionQuality < 8) weak.push('composition quality');
  return weak.length === 0
    ? '保持商品本体不变，只做轻量商业化收口。'
    : `重点改进：${weak.join(', ')}。`;
}

/**
 * Per-slot detail-image prompt builder. Each detail image references the
 * approved final master so the product stays identical across the carousel.
 * `slotIndex` is 1-based and only matters when a slot has count > 1 (we use
 * it to coax different angles for "feature closeup" and "lifestyle context").
 */
export function buildDetailImagePrompt(args: {
  brief: ProductBrief;
  slot: 'detail-hero' | 'detail-feature' | 'detail-lifestyle' | 'detail-scale';
  slotIndex: number;
}): string {
  const { brief, slot, slotIndex } = args;
  const sellingPoint =
    brief.coreSellingPoints[(slotIndex - 1) % Math.max(brief.coreSellingPoints.length, 1)]
    ?? '商品的关键工艺细节';
  const usageScene =
    brief.recommendedUsageScenes[(slotIndex - 1) % Math.max(brief.recommendedUsageScenes.length, 1)]
    ?? brief.recommendedPlacement[0]
    ?? 'a believable real-world usage context';

  const HEADER = [
    'Use Image 1 as the approved final product (do NOT redesign it; this is the canonical product master).',
    'Images 2 to N are product fidelity references.',
    '',
    'Strict requirements:',
    '- Keep the product identical in shape, proportions, silhouette, material texture, color, edges, and construction.',
    '- The product must be the focal subject; do not crop critical features out of frame unless explicitly instructed.',
    '- No logos, no text, no watermark, no added branding.',
    '- No collage, no split frames, no multiple repeated copies of the product.',
    '- Photorealistic commercial photography, not illustration.',
  ].join('\n');

  switch (slot) {
    case 'detail-hero':
      return [
        HEADER,
        '',
        'Task: produce a premium clean white-background hero variant for the detail-page carousel.',
        '- Pure neutral seamless white or near-white background.',
        '- Subtle soft natural shadow under the product to ground it.',
        '- Slightly different camera framing from the main image (e.g. tighter or 3/4 angle) so the carousel reads as a different shot.',
        `- Aspect ratio: ${brief.recommendedAspectRatio}.`,
        'Generate exactly one image.',
      ].join('\n');

    case 'detail-feature':
      return [
        HEADER,
        '',
        `Task: macro / close-up shot that highlights this selling point: "${sellingPoint}".`,
        '- Tight crop on the relevant part of the product (texture, mechanism, material seam, control surface, etc.).',
        '- Background: clean and unobtrusive; subtle bokeh acceptable.',
        '- Lighting: emphasize material qualities (specular highlights for glossy, soft wraparound for matte).',
        '- Do NOT zoom out to a full product shot; this is a feature close-up.',
        `- Aspect ratio: ${brief.recommendedAspectRatio}.`,
        'Generate exactly one image.',
      ].join('\n');

    case 'detail-lifestyle':
      return [
        HEADER,
        '',
        `Task: lifestyle scene showing the product in use within: ${usageScene}.`,
        '- Believable everyday environment that matches the product audience.',
        '- Product remains the visual hero (≥ 40% frame area, sharp focus).',
        `- Human / pet presence policy: ${brief.humanPresencePolicy} / ${brief.petPresencePolicy} (respect strictly).`,
        '- Natural ambient lighting consistent with the scene time-of-day.',
        '- No exaggerated styling, no surreal lighting.',
        `- Aspect ratio: ${brief.recommendedAspectRatio}.`,
        'Generate exactly one image.',
      ].join('\n');

    case 'detail-scale':
      return [
        HEADER,
        '',
        `Task: scale-reference image so a buyer instantly understands the product's real size (size class: ${brief.sizeClass}).`,
        brief.sizeClass === 'small'
          ? '- Show the product held in a human hand OR placed next to a familiar everyday object (coffee mug, smartphone, paperback book).'
          : brief.sizeClass === 'medium'
            ? '- Place the product on a surface next to a familiar reference (laptop, dinner plate, throw pillow) to convey scale.'
            : '- Show the product in a room context with a person or door visible at the edge of frame for scale, without blocking the product.',
        '- Lighting: clean, neutral, accurate color.',
        '- Composition must make the size relationship immediately readable in 1 second.',
        `- Aspect ratio: ${brief.recommendedAspectRatio}.`,
        'Generate exactly one image.',
      ].join('\n');
  }
}

export const FALLBACK_PROMPT = [
  'Use Image 1 as the cutout master product.',
  '',
  'Task: produce a clean white-background commercial fallback.',
  '',
  'Strict requirements:',
  '- Keep the product exactly as in Image 1.',
  '- Pure white background.',
  '- Add only a subtle natural grounding shadow.',
  '- Slight lighting cleanup, no environment, no props.',
  '- Do not change the product, color, or proportions.',
  '- Generate exactly one image.',
].join('\n');
