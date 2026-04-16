# 工作流 DSL — 电商一键出商品图

> 多层循环 + if-else 的完整案例，覆盖：参考图筛选 → brief 识别 → 抠图（含质检回路）→ 场景策划 → 3 方向生成 → 评分 → 精修（含质检回路）→ 保底兜底。

## 架构要点

### 封装原则（必读）
- **控制流是黑盒**：外部步骤**不能**读 `then/else/body` 内部的 owned 步骤
- **if-else 没有数据通道**：它的 output 只有 `{ branch: "then" | "else" }`，没有可消费字段
  - 想让下游消费"分支内的结果"，下游必须也放进同一分支
- **for-each 的 output**：`{ results, count }`，读 `steps.<id>.output.results[N].output.<字段>`
- **while / do-while 的 output**：`{ state, iterations, errors }`，**只能**通过 `state.update` 把 body 结果搬进 state，外部读 `steps.<id>.output.state.<字段>`

### 本工作流的关键决策
1. **抠图结果通过 `cutout-loop.state.cutoutResult` 暴露** — body 里的 `do-cutout` 是 owned，外部读不到
2. **所有"抠图成功后的步骤"全部搬进 `check-cutout-success.then`** — 因为 `check-cutout-success` 是 if-else 没法传数据，只能把下游步骤放进同分支
3. **`refine-subloop` 显式声明跨父容器的 dependsOn** — 让 body（do-refine / final-qc）能继承到 cutout-loop、identify-brief 等外部引用
4. **同 body 兄弟之间可以直接引用 output**（如 `cutout-qc` 读 `steps.do-cutout.output.summary`），不需要 dependsOn

### 状态机流

```
filter-refs
  ↓
identify-brief  |  cutout-loop (while, exposes state.qcPass/cutoutResult)
  ↓                    ↓
  └──────┬────────────┘
         ↓
  check-cutout-success (if-else)
    ├─ then: plan-directions → scene-refine-loop (while) → check-final-result (if-else)
    │                            ├─ body: generate → score → refine-subloop (while) → collect-state
    │                            │                            └─ body: do-refine → final-qc → eval-qc
    │                            └─ check-final-result
    │                                  ├─ then: output-success
    │                                  └─ else: output-fallback
    └─ else: cutout-failed-fallback
```

## 完整 DSL（直接粘贴可用，已通过 `validateWorkflowDslV2`）

```json
{
  "version": "v2",
  "name": "电商一键出商品图",
  "description": "基于商品原始图全自动完成：参考图筛选、brief 识别、抠图（含质检回路）、场景策划、3 方向生成、评分、终版精修（含质检回路）、含失败和白底保底兜底。",
  "steps": [
    {
      "id": "filter-refs",
      "type": "agent",
      "input": {
        "preset": "f2e2a856-5535-41be-98d5-1c04b5adbb9c",
        "prompt": "你收到了一组商品图片。Image 1 是商品主图，Images 2~N 是候选参考图。请执行参考图筛选：从 Images 2~N 中选出最多 4 张最适合下游商品保真任务的参考图。筛选规则：优先保留完整结构图、材质/纹理/缝线/边缘细节图、侧面/背面结构图；剔除带复杂场景的营销图、严重模糊图、低分辨率图、包装图、与商品本体无关的配件图。输出纯 JSON（不要 markdown 代码块）：{\"selectedIndexes\":[2,3,4,5],\"dropIndexes\":[6,7],\"reason\":\"string\",\"totalInputImages\":N,\"selectedImagePaths\":[\"路径列表\"]}",
        "outputMode": "structured"
      }
    },
    {
      "id": "identify-brief",
      "type": "agent",
      "dependsOn": ["filter-refs"],
      "input": {
        "preset": "f2e2a856-5535-41be-98d5-1c04b5adbb9c",
        "prompt": "分析筛选后的商品图片，识别商品信息，输出完整的电商商品 brief JSON。Image 1 是商品主图，Images 2~N 是经过筛选的商品保真参考图。输出纯 JSON（不要 markdown 代码块），字段：productType、categoryBucket(furniture|home_goods|kitchenware|beauty|fashion_accessory|pet_product|electronics|office_product|fitness_product|toy|generic)、sizeClass(small|medium|large)、channelGoal(marketplace_hero)、coreSellingPoints、targetAudience、recommendedUsageScenes、recommendedPlacement、recommendedSurfaceType、recommendedShotType(packshot|tabletop|room_scene|hero_closeup)、recommendedLighting、recommendedCameraAngle、recommendedLensStyle、recommendedDepthOfField(deep|moderate|shallow)、recommendedShadowStyle(soft_natural|crisp_controlled|diffused)、recommendedColorTemperature(warm|neutral|cool)、recommendedAspectRatio、recommendedSceneComplexity(minimal|moderate|rich)、occlusionTolerance(none|low)、humanPresencePolicy(forbidden|optional|required)、petPresencePolicy(forbidden|optional|required)、styleDirection、avoidElements、fidelityFocus、consistencyAnchors、confidence。归一化规则：confidence<7 启用保守默认；aspectRatio 缺失默认 4:5；cameraAngle 缺失默认 45-degree front angle；sceneComplexity 缺失默认 minimal；human/petPresencePolicy 缺失默认 forbidden；occlusionTolerance 缺失默认 none；surfaceType 缺失 small/medium 默认 clean tabletop or floor-adjacent surface，large 默认 room-scale floor placement；shotType 缺失 small/medium 默认 tabletop，large 默认 room_scene；lensStyle 缺失 small/medium 默认 50mm commercial product photography look，large 默认 35mm interior commercial photography look；depthOfField 缺失默认 moderate；shadowStyle 缺失默认 soft_natural；colorTemperature 缺失默认 neutral；consistencyAnchors 缺失从 fidelityFocus 选 3~6 个关键细节。",
        "context": { "filterResult": "steps.filter-refs.output.summary" },
        "outputMode": "structured"
      }
    },
    {
      "id": "cutout-loop",
      "type": "while",
      "dependsOn": ["filter-refs"],
      "input": {
        "condition": { "op": "neq", "left": "state.qcPass", "right": true },
        "body": ["do-cutout", "cutout-qc"],
        "maxIterations": 2,
        "mode": "do-while",
        "state": {
          "initial": { "qcPass": false, "qcResult": null, "cutoutResult": null },
          "update": {
            "qcPass": "steps.cutout-qc.output.pass",
            "qcResult": "steps.cutout-qc.output.summary",
            "cutoutResult": "steps.do-cutout.output.summary"
          }
        }
      }
    },
    {
      "id": "do-cutout",
      "type": "agent",
      "input": {
        "preset": "a398f8f3-ecd5-4a9c-be5e-a05384fe13cf",
        "prompt": "对商品主图执行背景移除抠图。如果上游质检结果不为空（说明这是第二次抠图），请启用 Fallback mode：Preserve the product exactly as in Image 1; Do not stylize the product; Keep more margin around the product; Do not change the original angle; Prioritize fidelity over cleanliness. 使用 reference_image_paths 传入所有图片（主图在前，参考图在后），调用 generate_image 执行抠图。输出抠图结果的图片路径。",
        "context": {
          "filterResult": "steps.filter-refs.output.summary",
          "previousQC": "state.qcResult"
        }
      }
    },
    {
      "id": "cutout-qc",
      "type": "agent",
      "input": {
        "preset": "f2e2a856-5535-41be-98d5-1c04b5adbb9c",
        "prompt": "对抠图结果进行质检。将抠图结果与原始商品参考图对比。检查项：structure、material、edgeQuality、completeness、backgroundCleanliness。structure/material/edgeQuality/completeness 任一 fail 则 pass=false；全部 pass 则 pass=true, retry=false。输出纯 JSON（不要 markdown）：{\"pass\":true,\"checks\":{\"structure\":\"pass|fail\",\"material\":\"pass|fail\",\"edgeQuality\":\"pass|fail\",\"completeness\":\"pass|fail\",\"backgroundCleanliness\":\"pass|fail\"},\"failReason\":\"string|null\",\"retry\":true}",
        "context": {
          "cutoutResult": "steps.do-cutout.output.summary",
          "filterResult": "steps.filter-refs.output.summary"
        },
        "outputMode": "structured"
      }
    },
    {
      "id": "check-cutout-success",
      "type": "if-else",
      "dependsOn": ["cutout-loop", "identify-brief"],
      "input": {
        "condition": { "op": "eq", "left": "steps.cutout-loop.output.state.qcPass", "right": true },
        "then": ["plan-directions", "scene-refine-loop", "check-final-result"],
        "else": ["cutout-failed-fallback"]
      }
    },
    {
      "id": "plan-directions",
      "type": "agent",
      "input": {
        "preset": "1aaa1821-c641-43ed-9905-9c435675e0dc",
        "prompt": "基于商品 brief JSON，生成 3 个差异化的电商场景方向（catalog / lifestyle / campaign）。规则：三个方向必须有实质性差异；catalog 优先干净的电商主图感；lifestyle 优先真实可信的生活场景；campaign 优先更强的视觉冲击力（不损害保真度）；必须尊重 brief 中的 humanPresencePolicy 和 petPresencePolicy；small/medium 商品避免过大房间场景；large 商品避免狭小桌面；所有描述用英文。输出纯 JSON：{\"directions\":[{\"id\":\"catalog\",\"scene\":\"string\",\"composition\":\"string\",\"lighting\":\"string\",\"mood\":\"string\",\"negativeRules\":[\"string\"]},{\"id\":\"lifestyle\",\"...\":\"...\"},{\"id\":\"campaign\",\"...\":\"...\"}]}",
        "context": { "brief": "steps.identify-brief.output.summary" },
        "outputMode": "structured"
      }
    },
    {
      "id": "scene-refine-loop",
      "type": "while",
      "dependsOn": ["plan-directions", "cutout-loop", "identify-brief"],
      "input": {
        "condition": {
          "op": "and",
          "conditions": [
            { "op": "neq", "left": "state.finalPass", "right": true },
            { "op": "lt", "left": "state.sceneAttempts", "right": 3 }
          ]
        },
        "body": ["generate-scenes", "score-scenes", "refine-subloop", "collect-iteration-state"],
        "maxIterations": 3,
        "mode": "do-while",
        "state": {
          "initial": {
            "finalPass": false,
            "sceneAttempts": 0,
            "lastScoreResult": null,
            "lastFinalQCResult": null,
            "lastRefineResult": null
          },
          "update": {
            "finalPass": "steps.collect-iteration-state.output.finalPass",
            "sceneAttempts": "steps.collect-iteration-state.output.sceneAttempts",
            "lastScoreResult": "steps.score-scenes.output.summary",
            "lastFinalQCResult": "steps.collect-iteration-state.output.lastFinalQCResult",
            "lastRefineResult": "steps.collect-iteration-state.output.lastRefineResult"
          }
        }
      }
    },
    {
      "id": "generate-scenes",
      "type": "agent",
      "input": {
        "preset": "ef59d499-50bf-4333-83f7-9620aa2966a2",
        "prompt": "基于抠图主图、参考图、商品 brief 和三个场景方向，分别生成 catalog、lifestyle、campaign 三张第一轮场景图。每个方向只生成 1 张。三个方向共用同一组商品图和 brief，只有 Direction 和 Negative rules 不同。如果上游评分或质检结果显示需要保守重跑，请在 prompt 末尾追加 Fallback mode 约束：Use a simpler background; Reduce scene complexity; Keep more empty space around the product; Avoid humans, pets, hands, and strong props unless strictly required; Prioritize product fidelity over atmosphere; Prefer the catalog look over dramatic styling. 输出三张图的路径，分别标明 catalog/lifestyle/campaign。",
        "context": {
          "cutoutResult": "steps.cutout-loop.output.state.cutoutResult",
          "filterResult": "steps.filter-refs.output.summary",
          "brief": "steps.identify-brief.output.summary",
          "directions": "steps.plan-directions.output.summary",
          "previousScore": "state.lastScoreResult",
          "previousFinalQC": "state.lastFinalQCResult"
        }
      }
    },
    {
      "id": "score-scenes",
      "type": "agent",
      "input": {
        "preset": "f2e2a856-5535-41be-98d5-1c04b5adbb9c",
        "prompt": "对三张第一轮场景图进行评分。将 catalog/lifestyle/campaign 与抠图主图和参考图对比。评分维度（0-10 整数）：productFidelity、structureAccuracy、detailConsistency、sceneSuitability、compositionQuality、photographicRealism、groundingRealism。规则：productFidelity/structureAccuracy/detailConsistency 权重最高；有明显变形的候选不能赢；两个接近时优先 product fidelity 高的；hardFail=true 当明显变形/材质错误/比例失调/被遮挡/多余物体；全部弱时 winnerId=none。自动重跑判断：winnerId=none 或最佳候选 productFidelity<8 或 structureAccuracy<8 或 detailConsistency<8 或 photographicRealism<7 或 groundingRealism<7 → needsRerun=true, nextAction=rerun_scene_generation；否则 nextAction=final_refine。输出纯 JSON：{\"scores\":[{\"id\":\"catalog\",\"productFidelity\":0,\"structureAccuracy\":0,\"detailConsistency\":0,\"sceneSuitability\":0,\"compositionQuality\":0,\"photographicRealism\":0,\"groundingRealism\":0,\"total\":0,\"hardFail\":false,\"hardFailReason\":null}],\"winnerId\":\"catalog|lifestyle|campaign|none\",\"winnerReason\":\"string\",\"nextAction\":\"final_refine|rerun_scene_generation\",\"needsRerun\":false}",
        "context": {
          "cutoutResult": "steps.cutout-loop.output.state.cutoutResult",
          "filterResult": "steps.filter-refs.output.summary",
          "sceneResults": "steps.generate-scenes.output.summary",
          "brief": "steps.identify-brief.output.summary"
        },
        "outputMode": "structured"
      }
    },
    {
      "id": "refine-subloop",
      "type": "while",
      "dependsOn": ["generate-scenes", "score-scenes", "cutout-loop", "identify-brief"],
      "input": {
        "condition": {
          "op": "and",
          "conditions": [
            { "op": "eq", "left": "state.needsRefine", "right": "final_refine" },
            { "op": "neq", "left": "state.qcPass", "right": true }
          ]
        },
        "body": ["do-refine", "final-qc", "eval-refine-qc"],
        "maxIterations": 2,
        "mode": "do-while",
        "state": {
          "initial": {
            "needsRefine": "steps.score-scenes.output.nextAction",
            "qcPass": false,
            "retryStage": "none",
            "lastFinalQCResult": null,
            "lastRefineResult": null
          },
          "update": {
            "qcPass": "steps.eval-refine-qc.output.qcPass",
            "retryStage": "steps.eval-refine-qc.output.retryStage",
            "lastFinalQCResult": "steps.final-qc.output.summary",
            "lastRefineResult": "steps.do-refine.output.summary"
          }
        }
      }
    },
    {
      "id": "do-refine",
      "type": "agent",
      "input": {
        "preset": "9a303903-2842-4ef2-b49c-3c830cae038a",
        "prompt": "基于最佳第一轮场景图执行终版精修。reference_image_paths 传入顺序：1. 最佳第一轮图（构图和场景方向基准）；2. 抠图主图（商品保真基准）；3. 商品保真参考图。终版精修提示词要点：Keep the product exactly consistent with the reference product images; Do not redesign or replace the product; Preserve shape, proportions, material texture, stitching, edges, and construction details; Keep the scene direction and composition from Image 1; Keep the same camera angle and aspect ratio as Image 1; Improve only the final commercial quality; Do not widen the scene, restyle the background, or change the product-to-background scale; Do not introduce new props, humans, hands, pets, or extra products. 根据评分 JSON 中的弱项针对性优化：photographicRealism 低→真实商业摄影质感；groundingRealism 低→可信物理接触；detailConsistency 低→材质纹理和边缘细节；compositionQuality 低→构图平衡。如果是重试（上游质检显示 final_refine 失败），基于上次质检 failReason 调整。调用 generate_image 生成 1 张终版图。建议使用 gemini-3-pro-image-preview 模型。",
        "context": {
          "cutoutResult": "steps.cutout-loop.output.state.cutoutResult",
          "filterResult": "steps.filter-refs.output.summary",
          "sceneResults": "steps.generate-scenes.output.summary",
          "scoreResult": "steps.score-scenes.output.summary",
          "brief": "steps.identify-brief.output.summary",
          "previousFinalQC": "state.lastFinalQCResult"
        }
      }
    },
    {
      "id": "final-qc",
      "type": "agent",
      "input": {
        "preset": "f2e2a856-5535-41be-98d5-1c04b5adbb9c",
        "prompt": "对终版精修图进行质检。将终版图与抠图主图和商品参考图对比。检查项：structure、proportion、material、details、color、shadow、grounding、photographicRealism、backgroundCleanliness、extraObjects、textOrWatermark。规则：structure/proportion/material/details 是阻断性检查项，任一 fail 则 pass=false；前四项通过但 shadow/grounding/photographicRealism/backgroundCleanliness/extraObjects/textOrWatermark/color 失败 → retryStage=final_refine；structure/proportion/material/details 任一失败 → retryStage=scene_generation；全部通过 → pass=true, retryStage=none。用 brief 中的 humanPresencePolicy/petPresencePolicy 判断额外人物/宠物是否允许。输出纯 JSON：{\"pass\":true,\"checks\":{\"structure\":\"pass|fail\",\"proportion\":\"pass|fail\",\"material\":\"pass|fail\",\"details\":\"pass|fail\",\"color\":\"pass|fail\",\"shadow\":\"pass|fail\",\"grounding\":\"pass|fail\",\"photographicRealism\":\"pass|fail\",\"backgroundCleanliness\":\"pass|fail\",\"extraObjects\":\"pass|fail\",\"textOrWatermark\":\"pass|fail\"},\"failReason\":\"string|null\",\"retryStage\":\"scene_generation|final_refine|none\"}",
        "context": {
          "refineResult": "steps.do-refine.output.summary",
          "cutoutResult": "steps.cutout-loop.output.state.cutoutResult",
          "filterResult": "steps.filter-refs.output.summary",
          "brief": "steps.identify-brief.output.summary"
        },
        "outputMode": "structured"
      }
    },
    {
      "id": "eval-refine-qc",
      "type": "agent",
      "input": {
        "preset": "f2e2a856-5535-41be-98d5-1c04b5adbb9c",
        "prompt": "根据终版质检结果，输出精修子循环的状态更新。这是一个纯逻辑步骤，不需要调用任何工具。规则：质检 pass=true → {\"qcPass\":true,\"retryStage\":\"none\"}；质检 retryStage=scene_generation → {\"qcPass\":false,\"retryStage\":\"scene_generation\"}（精修循环应退出）；质检 retryStage=final_refine → {\"qcPass\":false,\"retryStage\":\"final_refine\"}（精修循环继续重试）。",
        "context": { "qcResult": "steps.final-qc.output.summary" },
        "outputMode": "structured",
        "expectedOutput": "输出包含 qcPass 和 retryStage 的 JSON；不需要调用任何工具"
      }
    },
    {
      "id": "collect-iteration-state",
      "type": "agent",
      "input": {
        "preset": "f2e2a856-5535-41be-98d5-1c04b5adbb9c",
        "prompt": "汇总本轮场景迭代的最终状态。这是一个纯逻辑步骤，不需要调用任何工具。读取上游数据并按规则输出 JSON：1. 评分 nextAction=rerun_scene_generation（精修子循环被跳过）→ {finalPass:false, sceneAttempts:当前次数+1, lastFinalQCResult:null, lastRefineResult:null}；2. 精修子循环执行了且质检通过（qcPass=true）→ {finalPass:true, sceneAttempts:当前次数+1, lastFinalQCResult:质检摘要, lastRefineResult:精修摘要}；3. 精修子循环执行了但质检未通过且 retryStage=scene_generation → {finalPass:false, sceneAttempts:当前次数+1, lastFinalQCResult:质检摘要, lastRefineResult:精修摘要}；4. 精修子循环执行了但质检未通过且 retryStage=final_refine（精修次数耗尽）→ {finalPass:false, sceneAttempts:当前次数+1, lastFinalQCResult:质检摘要, lastRefineResult:精修摘要}。",
        "context": {
          "scoreResult": "steps.score-scenes.output.summary",
          "refineSubloopState": "steps.refine-subloop.output.state",
          "currentAttempts": "state.sceneAttempts"
        },
        "outputMode": "structured",
        "expectedOutput": "输出包含 finalPass、sceneAttempts、lastFinalQCResult、lastRefineResult 的 JSON；不需要调用任何工具"
      }
    },
    {
      "id": "check-final-result",
      "type": "if-else",
      "dependsOn": ["scene-refine-loop"],
      "input": {
        "condition": { "op": "eq", "left": "steps.scene-refine-loop.output.state.finalPass", "right": true },
        "then": ["output-success"],
        "else": ["output-fallback"]
      }
    },
    {
      "id": "output-success",
      "type": "agent",
      "input": {
        "preset": "f2e2a856-5535-41be-98d5-1c04b5adbb9c",
        "prompt": "终版商品图质检通过。请汇总最终产出 JSON：{\"status\":\"success\",\"finalImage\":\"终版图路径\",\"winnerId\":\"选中的方向\",\"briefSummary\":\"商品简述\",\"totalRetries\":{\"cutout\":N,\"scene\":N,\"refine\":N}}",
        "context": {
          "refineResult": "steps.scene-refine-loop.output.state.lastRefineResult",
          "scoreResult": "steps.scene-refine-loop.output.state.lastScoreResult",
          "brief": "steps.identify-brief.output.summary",
          "finalQC": "steps.scene-refine-loop.output.state.lastFinalQCResult"
        },
        "outputMode": "structured"
      }
    },
    {
      "id": "output-fallback",
      "type": "agent",
      "input": {
        "preset": "9a303903-2842-4ef2-b49c-3c830cae038a",
        "prompt": "场景生成和终版精修均已达到最大重试次数，仍未通过质检。执行保底方案：使用白底抠图终版 + 轻微阴影 + 轻微商业化清理作为最终保守交付结果。基于抠图主图，调用 generate_image 做最小程度商业化清理：保持纯白背景；添加轻微自然阴影；轻微提升光影质感；不改变商品本体；不添加任何场景元素。输出保底终版图路径。",
        "context": {
          "cutoutResult": "steps.cutout-loop.output.state.cutoutResult",
          "filterResult": "steps.filter-refs.output.summary",
          "brief": "steps.identify-brief.output.summary"
        }
      }
    },
    {
      "id": "cutout-failed-fallback",
      "type": "agent",
      "input": {
        "preset": "f2e2a856-5535-41be-98d5-1c04b5adbb9c",
        "prompt": "抠图经过两次尝试仍未通过质检，流程终止。请输出 JSON：{\"status\":\"cutout_failed\",\"message\":\"商品母版失败，抠图质检两次未通过，无法继续场景生成。建议更换更清晰的商品主图后重试。\",\"finalDelivery\":\"none\"}",
        "outputMode": "structured"
      }
    }
  ]
}
```

## 改动对照表（相对原始 DSL）

| # | 位置 | 改前 | 改后 | 原因 |
|---|------|------|------|------|
| 1 | `cutout-loop.state` | 只有 `qcPass` / `qcResult` | 加 `cutoutResult` | 把 body 内部的抠图结果搬出循环 |
| 2 | `generate-scenes.context.cutoutResult` | `steps.do-cutout.output.summary` | `steps.cutout-loop.output.state.cutoutResult` | 外部读不到 owned 步骤 |
| 3 | `score-scenes.context.cutoutResult` | 同上 | 同上 | 同上 |
| 4 | `do-refine.context.cutoutResult` | 同上 | 同上 | 同上 |
| 5 | `final-qc.context.cutoutResult` | 同上 | 同上 | 同上 |
| 6 | `output-fallback.context.cutoutResult` | 同上 | 同上 | 同上 |
| 7 | `cutout-qc.context.cutoutResult` | `steps.do-cutout.output.summary` | **保留不动** | 同 body 兄弟可直读 |
| 8 | `check-cutout-success.dependsOn` | `["cutout-loop"]` | `["cutout-loop","identify-brief"]` | plan-directions 要访问 identify-brief |
| 9 | `scene-refine-loop` 位置 | 顶层 | 放进 `check-cutout-success.then` | if-else 没数据通道，下游必须同分支 |
| 10 | `scene-refine-loop.dependsOn` | `["check-cutout-success"]` | `["plan-directions","cutout-loop","identify-brief"]` | 同 body 兄弟依赖 + 跨父的顶层依赖 |
| 11 | `refine-subloop.dependsOn` | 无 | `["generate-scenes","score-scenes","cutout-loop","identify-brief"]` | body 步骤要继承到这些外部引用 |
| 12 | `check-final-result` 位置 | 顶层 | 放进 `check-cutout-success.then` | 同 9 |
| 13 | `check-final-result.dependsOn` | `["scene-refine-loop"]` | 保留 | 同 body 兄弟依赖 |

## 关键字段速查

```
agent 步骤输出字段：
  - summary  （主要文本输出 / 结构化 JSON 字符串）
  - outcome  （"done" | "error" | "failed"）

while / do-while 输出字段：
  - state        （当前 state 对象，通过 state.update 维护）
  - iterations   （总迭代次数）
  - errors       （每轮错误数组）

for-each 输出字段：
  - results[N].output.<字段>   （每轮最后一个 body 步骤的完整 stepResult）
  - count                      （迭代次数）

if-else 输出字段：
  - branch       （"then" | "else"，没有数据通道）

state 引用规则：
  - state.xxx 只能出现在 while/do-while 的 body 或 condition 里
  - 循环外部读最终 state：steps.<while-id>.output.state.<字段>
```
