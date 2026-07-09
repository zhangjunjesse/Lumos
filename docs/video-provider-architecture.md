# 视频服务商系统 — 实际架构

> 与图片服务商同构（见 `docs/image-provider-architecture.md`，共享机制不再重述），本文只记录视频差异点。
> 截至 2026-07-09。

---

## 1. 与图片链路的对应关系

| 环节 | 图片 | 视频 |
|---|---|---|
| 云端权威表 | `lumos_image_providers` | `lumos_video_providers` |
| 云端管理页 | `/admin/image-providers` | `/admin/video-providers` |
| 下发字段 | `image_providers` | `video_providers`（login / me / register 三处） |
| 桌面同步 | `provisionImageProviders` | `provisionVideoProviders`（`src/lib/cloud/provisioner.ts`） |
| override keys | `provider_override:image` / `model_override:image` / `lumos_cloud_image_providers_map` | `provider_override:video` / `model_override:video` / `lumos_cloud_video_providers_map` |
| Agent 工具 | `generate_image` | `generate_video`（同一 `lumos-image` MCP server） |
| 计费接口 | `/api/quota/image/consume` | `/api/quota/video/consume` |
| 计费单位 | `price_per_image × count` | `price_per_second × duration_seconds` |
| 流水表 | `lumos_image_usage` | `lumos_video_usage`（`duration_seconds` 替代 `count`） |

计费均为纯整数算术（500000 配额 = ¥1），先扣后生成、失败 best-effort 退款、幂等键防重。
admin UI 视频单价输入「元/秒」支持 3 位小数（0.001 元/秒 = 500 配额，仍是整数）。

## 2. 计费与生成的一致性约束

`video-gen-tool.ts` 在扣费前解析出 `(model, durationSeconds)` 并**原样传给** `generateVideo`，
不让 `generate.ts` 内部 fallback 链产生第二种答案：

1. `resolveVideoBillingTarget(args.model)`（`src/lib/tools/video-gen-billing.ts`）
   - provider：`resolveProviderForCapability({moduleKey:'video', capability:'video-gen', allowDefault:false})`，与 generate.ts 完全一致。
   - model：agent 显式指定（catalog 校验，不在目录中直接报错，不静默改写）→ `model_override:video` → provider 有效默认 → catalog[0]。
   - defaultDuration：provider `LUMOS_VIDEO_DEFAULTS.duration` → 模型档案默认。
2. `validateVideoDuration(model, duration)` **发生在扣费之前**——非法时长不产生「扣了再退」的流水。
3. 有 `userId`（Pro 云计费）时强制要求云端下发的 provider（remote map 反查），BYO 自建 provider 走 `provider_direct` 不扣云端余额（与图片同门控）。

## 3. ToAPIs 真实请求契约（教训）

首次真实验证时发现 mock 全绿但线上 100% 失败：请求体字段是想当然写的
（`size: "16:9"`、`duration 6|10`、`reference_images`），真实 API 完全不认。

**单一真源：`src/lib/video/model-profiles.ts`**，依据 docs.toapis.com 各模型 generation 文档：

| 参数 | wan2.6 | wan2.6-flash | gemini_omni_flash |
|---|---|---|---|
| `aspect_ratio` | 16:9 / 9:16 / 1:1 / 4:3 / 3:4 | 不接受（由参考素材决定） | 16:9 / 9:16 |
| `resolution` | `720p` / `1080p`（小写） | 同左 | `720P` / `1080p`（原样大小写） |
| `duration` | 5 / 10 / 15 | 5 / 10 / 15 | 4 / 6 / 10 |
| 参考图 | 顶层 `image_urls` ≤1 | ≤1，与参考视频二选一 | ≤3 |
| 参考视频 | `metadata.reference_urls` | 同左 | 不支持 |
| 纯文生视频 | 支持 | **不支持** | 支持 |

生成（buildRequestBody）、计费（默认时长）、UI 配置（`provider-ui.ts` 取并集）都从档案取值；
未知模型走 PASSTHROUGH 档案（透传、不做客户端校验）。
改模型参数只改 `model-profiles.ts`，`generate.test.ts` 锁住请求体 shape。

## 4. 生成执行流（`src/lib/video/generate.ts`）

提交 `POST /v1/videos/generations` → 轮询 `GET /v1/videos/generations/{id}`（5s 间隔，30min 上限）
→ 下载 mp4 到 `~/.lumos-media/` → `media_generations` 入库（type='video'，metadata 含
mode/duration/resolution/taskId/参考素材）。本地参考素材先经 `/v1/uploads/{images,videos}` 换 URL。

## 5. 相关代码位置

- **云端**：`lumos-web/src/lib/video-providers.ts`、`lumos-web/src/lib/quota/video-billing.ts`、
  `lumos-web/src/app/{admin/video-providers,api/admin/video-providers,api/quota/video/consume}`
- **桌面计费**：`src/lib/tools/video-gen-billing.ts`（HTTP 传输层与图片共用 `src/lib/tools/media-quota-client.ts`）
- **桌面生成**：`src/lib/video/{generate,model-profiles,provider-defaults,provider-ui}.ts`
- **Agent 入口**：`src/lib/tools/video-gen-tool.ts`（`lumos-mcp-server.ts` 注册，提示词 `image-gen-hints.ts` 的 `VIDEO_GEN_IN_PROCESS_HINT`）
- **UI**：`src/components/settings/ImageProviderSection.tsx`（`VideoProviderSection` 复用）、`src/components/chat/VideoGenCard.tsx`、素材库 Gallery*

## 6. 已知缺口（非主链）

- 聊天内无「取消生成」按钮与实时进度条（`abortSignal`/`onProgress` 底层已支持，UI 未接）。
- 无视频封面帧提取、无转码；素材库直接播放 mp4。
- lumos-web 端 `lumos_video_usage` 尚无 admin 报表页（图片同样没有）。
