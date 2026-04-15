# 电商商品图生成 SOP（全自动版，Gemini / Nano Banana）

## 第 1 步：收集输入图

输入：

1. `图1`：最清晰的原始商品图
2. `图2 ~ 图N`：商品参考图

固定规则：

1. `图1` 永远是主输入图。
2. `图2 ~ 图N` 永远是商品保真参考图。
3. 这一步不放场景图。
4. 这一步不放构图图。

自动前处理规则：

1. 保留总输入图不超过 `5` 张。
2. 如果参考图超过 `4` 张，先自动筛选，再进入后续步骤。
3. 自动筛选时优先保留：
   - 完整结构图
   - 材质 / 纹理 / 缝线 / 边缘细节图
   - 侧面 / 背面结构图
4. 自动剔除：
   - 带复杂场景的营销图
   - 严重模糊图
   - 低分辨率图
   - 包装图
   - 与商品本体无关的配件图

如果参考图超过 4 张，先执行这个提示词：

```text
Image 1 is the primary product image.
Images 2 to N are candidate fidelity reference images.

Select up to 4 supporting reference images for downstream product-preservation tasks.

Rules:
- Return valid JSON only. No markdown. No code fences.
- Prefer images that best preserve geometry, material, texture, stitching, edges, and secondary angles.
- Exclude packaging, lifestyle marketing compositions, blurry images, and redundant duplicates.

Schema:
{
  "selectedIndexes": [2, 3, 4, 5],
  "dropIndexes": [6, 7],
  "reason": "string"
}
```

输出：

1. 一组待处理商品图

---

## 第 2 步：让 AI 识别商品信息

输入：

1. 第 1 步的全部图片

提示词：

```text
Analyze the provided product images.

Image 1 is the primary product image.
Images 2 to N are supporting product reference images.

Your task is to identify the product and produce a structured e-commerce brief.

Rules:
- Return valid JSON only. No markdown. No code fences.
- Do not invent facts that are not visible from the images.
- If a field is uncertain, use conservative generic wording.
- Focus on commercially useful observations only.

Schema:
{
  "productType": "string",
  "categoryBucket": "furniture | home_goods | kitchenware | beauty | fashion_accessory | pet_product | electronics | office_product | fitness_product | toy | generic",
  "sizeClass": "small | medium | large",
  "channelGoal": "marketplace_hero",
  "coreSellingPoints": ["string"],
  "targetAudience": ["string"],
  "recommendedUsageScenes": ["string"],
  "recommendedPlacement": ["string"],
  "recommendedSurfaceType": "string",
  "recommendedShotType": "packshot | tabletop | room_scene | hero_closeup",
  "recommendedLighting": "string",
  "recommendedCameraAngle": "string",
  "recommendedLensStyle": "string",
  "recommendedDepthOfField": "deep | moderate | shallow",
  "recommendedShadowStyle": "soft_natural | crisp_controlled | diffused",
  "recommendedColorTemperature": "warm | neutral | cool",
  "recommendedAspectRatio": "string",
  "recommendedSceneComplexity": "minimal | moderate | rich",
  "occlusionTolerance": "none | low",
  "humanPresencePolicy": "forbidden | optional | required",
  "petPresencePolicy": "forbidden | optional | required",
  "styleDirection": ["string"],
  "avoidElements": ["string"],
  "fidelityFocus": ["string"],
  "consistencyAnchors": ["string"],
  "confidence": 0
}
```

输出：

1. 一份商品 brief JSON

商品 brief 自动归一规则：

1. 如果 `confidence < 7`，启用保守默认值。
2. 如果 `recommendedAspectRatio` 缺失：
   - `furniture / home_goods / pet_product` 用 `4:5`
   - `kitchenware / beauty / fashion_accessory / electronics / office_product / toy / generic` 用 `4:5`
3. 如果 `recommendedCameraAngle` 缺失，默认 `45-degree front angle`
4. 如果 `recommendedSceneComplexity` 缺失，默认 `minimal`
5. 如果 `humanPresencePolicy` 缺失，默认 `forbidden`
6. 如果 `petPresencePolicy` 缺失，默认 `forbidden`
7. 如果 `occlusionTolerance` 缺失，默认 `none`
8. 如果 `recommendedSurfaceType` 缺失：
   - `small / medium` 默认 `clean tabletop or floor-adjacent surface`
   - `large` 默认 `room-scale floor placement`
9. 如果 `recommendedShotType` 缺失：
   - `small / medium` 默认 `tabletop`
   - `large` 默认 `room_scene`
10. 如果 `recommendedLensStyle` 缺失：
   - `small / medium` 默认 `50mm commercial product photography look`
   - `large` 默认 `35mm interior commercial photography look`
11. 如果 `recommendedDepthOfField` 缺失，默认 `moderate`
12. 如果 `recommendedShadowStyle` 缺失，默认 `soft_natural`
13. 如果 `recommendedColorTemperature` 缺失，默认 `neutral`
14. 如果 `consistencyAnchors` 缺失，默认从 `fidelityFocus` 中选取 3 到 6 个最关键商品细节作为强保真锚点。

---

## 第 3 步：先做抠图

输入：

1. `图1`：原始商品主图
2. `图2 ~ 图N`：商品保真参考图

模型建议：

1. 第一次抠图默认用 `gemini-3.1-flash-image-preview`
2. 如果第一次抠图失败且进入保守重跑，第二次抠图升级到 `gemini-3-pro-image-preview`

提示词：

```text
Use Image 1 as the main product subject.
Use Images 2 to N only as fidelity references.

Task:
Remove the background and isolate the product.

Strict requirements:
- Keep the product from Image 1 as the exact subject.
- Preserve the shape, proportions, silhouette, perspective, material texture, seams, edges, and construction details.
- Do not redesign the product.
- Do not change the product color.
- Keep the full product visible.
- Keep the original camera angle and overall framing as much as possible.
- Do not add props, environment, or extra objects.
- Do not add text, watermark, or logo-like graphics.
- Output a clean isolated product image on a pure white background.
- Add only a subtle natural grounding shadow if needed.

This is a product cutout task, not a creative generation task.
```

输出：

1. `抠图主图`

固定规则：

1. 从这一步开始，`抠图主图` 永远成为后续所有阶段的 `图1`。
2. 抠图完成后立即执行自动质检。

抠图自动质检提示词：

```text
Evaluate the cutout image against the original product references.

Rules:
- Return valid JSON only. No markdown. No code fences.
- Be strict about structure, material, edge quality, and completeness.

Schema:
{
  "pass": true,
  "checks": {
    "structure": "pass | fail",
    "material": "pass | fail",
    "edgeQuality": "pass | fail",
    "completeness": "pass | fail",
    "backgroundCleanliness": "pass | fail"
  },
  "failReason": "string | null",
  "retry": true
}
```

抠图失败回路：

1. 如果 `structure / material / edgeQuality / completeness` 任一失败，自动重跑一次抠图。
2. 第二次抠图追加下面这段保守提示：

```text
Fallback mode:
- Preserve the product exactly as in Image 1.
- Do not stylize the product.
- Keep more margin around the product.
- Do not change the original angle.
- Prioritize fidelity over cleanliness.
```

3. 如果第二次仍失败，停止后续场景生成，直接输出“商品母版失败”。

---

## 第 4 步：让 AI 自动生成 3 个场景方向

输入：

1. 第 2 步输出的商品 brief JSON

提示词：

```text
You are generating three e-commerce image directions for a product.

Use the following product brief:
[在这里插入第2步输出的 JSON]

Rules:
- Return valid JSON only. No markdown. No code fences.
- The three directions must be materially different from each other.
- `catalog` must prioritize clean marketplace usability.
- `lifestyle` must prioritize believable real-life context.
- `campaign` must prioritize stronger visual atmosphere without harming product fidelity.
- Do not propose scenes that conflict with the product type or target audience.
- Respect `humanPresencePolicy` and `petPresencePolicy` from the product brief.
- If the product is small, avoid oversized room scenes that make the product visually insignificant.
- If the product is large, avoid tiny surfaces or cramped compositions.

Schema:
{
  "directions": [
    {
      "id": "catalog",
      "scene": "string",
      "composition": "string",
      "lighting": "string",
      "mood": "string",
      "negativeRules": ["string"]
    },
    {
      "id": "lifestyle",
      "scene": "string",
      "composition": "string",
      "lighting": "string",
      "mood": "string",
      "negativeRules": ["string"]
    },
    {
      "id": "campaign",
      "scene": "string",
      "composition": "string",
      "lighting": "string",
      "mood": "string",
      "negativeRules": ["string"]
    }
  ]
}
```

输出：

1. 三个方向的 JSON

固定规则：

1. 不需要人工确认。
2. 三个方向必须都生成。
3. 如果返回 JSON 非法、字段缺失、或三种方向明显重复，则启用默认方向模板。

默认方向模板：

```json
{
  "directions": [
    {
      "id": "catalog",
      "scene": "clean premium marketplace scene with minimal background and strong product focus",
      "composition": "full product visibility, centered or slightly off-center, clean negative space",
      "lighting": "soft natural light with controlled product shadow",
      "mood": "clean, calm, premium, trustworthy",
      "negativeRules": ["no clutter", "no human", "no pet", "no extra products"]
    },
    {
      "id": "lifestyle",
      "scene": "believable real-life environment matching product usage, but still product-dominant",
      "composition": "45-degree commercial angle with visible environment context",
      "lighting": "soft realistic daylight",
      "mood": "warm, believable, relaxed, welcoming",
      "negativeRules": ["no blocked product", "no exaggerated props", "no text or watermark"]
    },
    {
      "id": "campaign",
      "scene": "premium commercial atmosphere with controlled styling and strong product dominance",
      "composition": "balanced hero composition with more depth but full product visibility",
      "lighting": "refined commercial light with clean highlights and shadow separation",
      "mood": "elevated, refined, polished, aspirational",
      "negativeRules": ["no excessive drama", "no product deformation", "no extra branded elements"]
    }
  ]
}
```

---

## 第 5 步：分别生成 3 张第一轮场景图

输入：

1. `图1`：抠图主图
2. `图2 ~ 图N`：商品保真参考图
3. 第 2 步的商品 brief JSON
4. 第 4 步的三个方向 JSON

模型建议：

1. 第一轮场景图默认用 `gemini-3.1-flash-image-preview`
2. 如果第一轮场景图两次都失败，不再继续升级场景复杂度，而是回退到白底终版路线

自动宽高比控制规则：

1. 如果 `recommendedAspectRatio` 已明确，系统必须按这个比例出图。
2. 如果输入图片比例混杂，且需要强控最终比例，系统要额外提供一张中性构图参考图并放在最后一张。
3. 这张中性构图参考图只能控制比例和留白，不能承载商品设计信息。
4. 不能把任意一张商品保真图放在最后，避免模型错误继承最后一张的比例与构图。
5. 如果没有额外构图参考图，则默认继承 `图1` 的主体尺度与画幅感。

对 `catalog` 方向使用这个模板：

```text
Use Image 1 as the main product subject.
Images 2 to N are product fidelity references.

Task:
Place the product from Image 1 into a premium e-commerce scene.

Strict requirements:
- Keep the product in Image 1 as the exact subject.
- Preserve the product’s shape, proportions, silhouette, perspective, material texture, seams, edges, and construction details.
- Do not redesign the product.
- Do not replace the product with another product.
- Keep the product fully visible.
- Keep the product as the clear focal point.
- Do not add logos, text, labels, or watermark.
- Use the supporting images only to preserve product fidelity.
- Do not copy brand-specific identifiers from any reference image.
- Do not crop the product.
- Do not mirror or flip the product.
- Do not change left/right-facing orientation unless the source image already supports it.
- Do not let props, furniture, hands, humans, or pets block the product unless explicitly allowed by the product brief.

Product brief:
[插入第2步输出的 JSON]

Direction:
[插入第4步中 catalog 对应的 scene/composition/lighting/mood]

Negative rules:
[插入第4步中 catalog 对应的 negativeRules]

Important:
- Change the environment only.
- Keep the product itself as consistent as possible with Image 1 and the fidelity references.
- Use the recommended aspect ratio exactly.
- Do not change the image ratio or crop logic unless a system-provided ratio-control image explicitly requires it.
- Respect `recommendedSurfaceType` and `recommendedSceneComplexity` from the product brief.
- If `sizeClass=small`, keep a closer composition and tabletop-scale environment.
- If `sizeClass=large`, use room-scale placement and avoid tiny surfaces.
- Render a coherent photorealistic commercial scene, not a collage of visual keywords.
- Keep perspective, scale, light direction, and contact shadows physically plausible.
- Avoid CGI-like plastic surfaces, over-smoothing, fake reflections, or over-saturated color.
- Avoid extreme shallow depth of field that hides product edges or detail anchors.
- Keep background elements secondary and believable.
- High-end commercial e-commerce photography.
- Generate exactly one image.
- If the product brief says `humanPresencePolicy=forbidden`, do not add humans, hands, or body parts.
- If the product brief says `petPresencePolicy=forbidden`, do not add pets.

Photography controls:
- Shot type: [插入第2步的 recommendedShotType]
- Camera angle: [插入第2步的 recommendedCameraAngle]
- Lens style: [插入第2步的 recommendedLensStyle]
- Depth of field: [插入第2步的 recommendedDepthOfField]
- Shadow style: [插入第2步的 recommendedShadowStyle]
- Color temperature: [插入第2步的 recommendedColorTemperature]
- Consistency anchors to preserve: [插入第2步的 consistencyAnchors]
```

对 `lifestyle` 方向使用同一个模板，只替换 Direction。

对 `campaign` 方向使用同一个模板，只替换 Direction。

输出：

1. `catalog 第一轮图`
2. `lifestyle 第一轮图`
3. `campaign 第一轮图`

固定规则：

1. 每个方向只生成 1 张。
2. 第一轮不做终版精修。
3. 三个方向共用同一组商品图、同一份商品 brief、同一组摄影控制字段，只允许 `scene / composition / lighting / mood / negativeRules` 变化。

---

## 第 6 步：让 AI 自动评分并选出最佳方向

输入：

1. `图1`：抠图主图
2. `图2 ~ 图N`：商品保真参考图
3. `catalog 第一轮图`
4. `lifestyle 第一轮图`
5. `campaign 第一轮图`
6. 第 2 步的商品 brief JSON

提示词：

```text
Evaluate the three generated e-commerce images.

Image 1 is the cutout master product image.
Images 2 to N are product fidelity references.
The three candidate images are provided separately as:
- catalog candidate
- lifestyle candidate
- campaign candidate

Use the product brief, especially `fidelityFocus` and `consistencyAnchors`, as the source of truth for what must stay consistent.

Score each candidate on:
1. product fidelity
2. structure accuracy
3. material/detail consistency
4. scene suitability for e-commerce
5. composition quality
6. photographic realism
7. grounding realism

Rules:
- Return valid JSON only. No markdown. No code fences.
- Use integer scores from 0 to 10.
- `productFidelity`, `structureAccuracy`, and `detailConsistency` are more important than style.
- `photographicRealism` means the image should look like a believable commercial photograph, not synthetic CGI.
- `groundingRealism` means the product should feel physically placed in the scene with believable scale, contact shadow, and surface interaction.
- If any candidate has obvious product deformation, it must not win.
- If any candidate looks pasted, floating, or physically disconnected from the surface, its `groundingRealism` must be low.
- If two candidates are close, prefer the one with higher product fidelity.
- Mark `hardFail=true` if there is obvious deformation, wrong material, wrong proportions, blocked product, or major extra objects.
- If all candidates are weak, return `winnerId` as `none`.

Schema:
{
  "scores": [
    {
      "id": "catalog",
      "productFidelity": 0,
      "structureAccuracy": 0,
      "detailConsistency": 0,
      "sceneSuitability": 0,
      "compositionQuality": 0,
      "photographicRealism": 0,
      "groundingRealism": 0,
      "total": 0,
      "hardFail": true,
      "hardFailReason": "string | null"
    },
    {
      "id": "lifestyle",
      "productFidelity": 0,
      "structureAccuracy": 0,
      "detailConsistency": 0,
      "sceneSuitability": 0,
      "compositionQuality": 0,
      "photographicRealism": 0,
      "groundingRealism": 0,
      "total": 0,
      "hardFail": true,
      "hardFailReason": "string | null"
    },
    {
      "id": "campaign",
      "productFidelity": 0,
      "structureAccuracy": 0,
      "detailConsistency": 0,
      "sceneSuitability": 0,
      "compositionQuality": 0,
      "photographicRealism": 0,
      "groundingRealism": 0,
      "total": 0,
      "hardFail": true,
      "hardFailReason": "string | null"
    }
  ],
  "winnerId": "catalog | lifestyle | campaign | none",
  "winnerReason": "string",
  "nextAction": "final_refine | rerun_scene_generation"
}
```

输出：

1. 一份评分 JSON
2. 一个自动选中的 `winnerId`

固定规则：

1. 不需要人工选方向。
2. 由 AI 自动选出最佳方向。
3. 优先依据 `product fidelity` 和 `structure accuracy`。
4. 如果 `winnerId=none` 或 `nextAction=rerun_scene_generation`，则自动回到第 5 步，并改用保守重跑模板。
5. 如果最佳候选的 `productFidelity < 8`，自动重跑。
6. 如果最佳候选的 `structureAccuracy < 8`，自动重跑。
7. 如果最佳候选的 `detailConsistency < 8`，自动重跑。
8. 如果最佳候选的 `photographicRealism < 7`，自动重跑。
9. 如果最佳候选的 `groundingRealism < 7`，自动重跑。
10. 第一轮场景生成最多重跑 `2` 次。

保守重跑模板追加约束：

```text
Fallback mode:
- Use a simpler background.
- Reduce scene complexity.
- Keep more empty space around the product.
- Avoid humans, pets, hands, and strong props unless strictly required by the product brief.
- Prioritize product fidelity over atmosphere.
- Prefer the `catalog` look over dramatic styling.
```

---

## 第 7 步：准备终版精修输入

输入：

1. `图1`：第 3 步的抠图主图
2. `图2 ~ 图N`：商品保真参考图
3. 第 6 步自动选中的最佳第一轮图

重新排序后的固定顺序：

1. `图1`：最佳第一轮图
2. `图2`：抠图主图
3. `图3 ~ 图N`：商品保真参考图

输出：

1. 一组终版精修输入图

---

## 第 8 步：生成终版精修 prompt

输入：

1. 第 7 步的终版精修输入图
2. 第 2 步的商品 brief JSON
3. 第 6 步的评分 JSON

提示词：

```text
Use Image 1 as the base composition and scene direction.
Use Images 2 to N as product fidelity references.

Task:
Refine this image into a final premium e-commerce product image.

Strict requirements:
- Keep the product exactly consistent with the reference product images.
- Do not redesign or replace the product.
- Preserve the product shape, proportions, material texture, stitching, edges, and construction details.
- Keep the scene direction and composition from Image 1.
- Keep the same camera angle and aspect ratio as Image 1.
- Improve only the final commercial quality.
- Keep this as a precise refinement pass.
- Use the score report only to identify weak areas that need fixing.
- Keep everything else the same unless explicitly improved by the refinement goals.
- Do not widen the scene, restyle the background, or change the product-to-background scale.
- Do not introduce new props, humans, hands, pets, or extra products unless they already exist in Image 1 and are required by the product brief.

Refinement goals:
- Make the lighting cleaner and more premium.
- Improve realism of shadows and product grounding.
- Make the product stand out more clearly from the background.
- Improve texture clarity and edge cleanliness.
- Reduce visual clutter.
- Keep the composition balanced and suitable for e-commerce.
- Preserve natural material response and believable surface interaction.

Style:
High-end commercial e-commerce photography.
Clean, realistic, premium, trustworthy.
No text, no watermark, no extra products.
Generate exactly one image.
```

输出：

1. 终版精修 prompt

---

## 第 9 步：生成终版图

输入：

1. 第 7 步的终版精修输入图
2. 第 8 步的终版精修 prompt

模型建议：

1. 用 `gemini-3-pro-image-preview`

输出：

1. `终版商品图`

固定规则：

1. 这一步只生成 1 张。
2. 这一步不再更换场景方向。
3. 这一步只做终版收口。
4. 终版精修最多重跑 `2` 次。
5. 第 3 步、第 5 步、第 9 步都使用新的独立请求执行，不在同一长对话里连续追问，避免多轮上下文造成商品漂移。
6. 每个阶段只向模型传入该阶段需要的图片和结构化结果，不把历史噪音全部继续带入。

---

## 第 10 步：让 AI 自动做终版质检

输入：

1. `终版商品图`
2. `抠图主图`
3. 商品保真参考图
4. 第 2 步的商品 brief JSON

提示词：

```text
Evaluate the final generated e-commerce image against the product references.

Use the product brief only to judge whether extra humans, pets, hands, or props are allowed.

Rules:
- Return valid JSON only. No markdown. No code fences.
- Be strict about product fidelity.
- If you are uncertain about structure, material, or details, mark them as fail.
- `structure`, `proportion`, `material`, and `details` are blocking checks.
- If only lighting, shadow, or cleanliness is weak while product fidelity is intact, prefer `final_refine`.
- If any extra human, hand, pet, or large prop appears and is not allowed by the product brief, mark `extraObjects=fail`.
- If the product looks floating, pasted, or physically disconnected from the surface, mark `grounding=fail`.
- If the image looks synthetic, over-smoothed, or not like a believable commercial photo, mark `photographicRealism=fail`.

Schema:
{
  "pass": true,
  "checks": {
    "structure": "pass | fail",
    "proportion": "pass | fail",
    "material": "pass | fail",
    "details": "pass | fail",
    "color": "pass | fail",
    "shadow": "pass | fail",
    "grounding": "pass | fail",
    "photographicRealism": "pass | fail",
    "backgroundCleanliness": "pass | fail",
    "extraObjects": "pass | fail",
    "textOrWatermark": "pass | fail"
  },
  "failReason": "string | null",
  "retryStage": "scene_generation | final_refine | none"
}
```

输出：

1. 一份终版质检 JSON

固定规则：

1. 如果 `structure / proportion / material / details` 任一失败，回到第 5 步重跑第一轮场景图。
2. 如果前面四项都通过，只是 `shadow / grounding / photographicRealism / backgroundCleanliness / extraObjects / textOrWatermark / color` 失败，回到第 8 步重做终版精修。
3. 如果全部通过，结束。
4. 如果第 5 步已经重跑满 `2` 次且仍失败，则直接回退到“白底抠图终版”作为保守交付结果。

---

## 第 11 步：固定回路规则

回路 1：

1. 商品本体失败
2. 回到第 5 步
3. 重新生成三张第一轮图
4. 重新评分
5. 再进终版精修

回路 2：

1. 商品本体通过
2. 只是环境和收口失败
3. 回到第 8 步
4. 重新做终版精修

回路 3：

1. 场景生成已经重跑 2 次仍失败
2. 停止继续扩场景
3. 直接使用“白底抠图终版 + 轻微阴影 + 轻微商业化清理”作为最终保守结果

---

## 第 12 步：不同商品都按同一套 SOP 跑

固定不变：

1. 图片顺序不变
2. 抠图步骤不变
3. 三个方向不变
4. 评分步骤不变
5. 精修步骤不变
6. 质检步骤不变

会变化的只有：

1. 第 2 步里 AI 识别出的商品 brief
2. 第 4 步里 AI 生成的三个方向内容

也就是说：

1. 不同商品，不重新设计流程
2. 不同商品，只重新生成商品 brief 和方向描述

---

## 第 13 步：系统里的固定口令

内部执行时固定遵守：

1. `图1 在抠图前是原始主图，在抠图后是抠图主图`
2. `中间图片永远是商品保真参考图`
3. `最后一张只在需要时才作为构图参考图`
4. `先抠图，再生成场景`
5. `先生成三张第一轮图，再自动评分`
6. `自动选最佳方向，不让人中途确认`
7. `终版只精修，不换方向`
8. `终版失败后，按失败类型自动回路`
9. `场景生成最多 2 次，终版精修最多 2 次`
10. `所有路径都失败时，回退到白底抠图终版`
11. `每个阶段使用新的独立请求，避免多轮上下文导致商品漂移`
12. `Prompt 用完整句子表达摄影目标和禁止项，不用零散关键词堆砌`
