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

**单一真源：`src/lib/video/model-profiles.ts`（类型+帮助函数）+ `model-profile-data.ts`（31 个模型档案）**，
逐条对照 docs.toapis.com 各模型 generation 文档录入。家族差异远超字段值——协议本身不同：

| 家族 | 模型 | 关键差异 |
|---|---|---|
| Wan | wan2.6 / wan2.6-flash | `image_urls`≤1、参考视频走 `metadata.reference_urls`、flash 二者互斥且不支持纯文生、分辨率小写 |
| Gemini Omni | gemini_omni / _flash | `image_urls`≤3、时长 4/6/10、分辨率 `720P`/`1080p` 原样大小写 |
| Sora 2 | sora-2-official / -vvip | 无分辨率参数、时长 4/8/12 |
| Veo 3.1 | 逆向 3 档 + 官方 2 档 | 逆向版时长只有 8 且 `resolution` 在 **metadata** 里；官方版 4/6/8 顶层 resolution；支持 4k |
| 海螺 | Hailuo-02 / 2.3 / 2.3-Fast | 无 `aspect_ratio` 参数、分辨率大写 P（512P 仅图生可用）、2.3-Fast 只图生 |
| Vidu Q3 | viduq3 / -pro / -turbo | 本体只参考图生（≤7 张）、pro/turbo 文生（≤2 张）、时长区间 1-16 |
| Grok | grok-video-3 / 1.5-preview | **duration 传字符串**、参考图字段是 `images`、1.5 只图生 |
| 可灵 | v2-6 / v3 / 3.0-turbo / v3-omni / video-o1 | 分辨率映射成 `mode: std/pro`（turbo 例外用 resolution）；omni/o1 的占位符参考图协议未接入（只开放文生） |
| Seedance 2 | 2 / fast / mini | 参考图/视频走**角色数组** `image_with_roles`/`video_with_roles`（role: reference_image/reference_video） |
| 豆包 Seedance | 1.0 pro ×2 / 1.5 pro | `image_with_roles`；1.0 用 role `reference`，1.5 只认 `first_frame`/`last_frame` 且 resolution 在 metadata |
| HappyHorse | happyhorse-1.1 | 请求体带 `action` 字段（text-to-video/reference-to-video/video-edit），视频编辑传顶层 `url` |

生成（buildRequestBody）、计费（默认时长）、UI 配置（`provider-ui.ts` 取并集）都从档案取值；
未知模型走 PASSTHROUGH 档案（透传、不做客户端校验）。预设目录与档案的一致性有测试守护
（`model-profiles.test.ts`），`generate.test.ts` 逐家族锁请求体 shape。

**网关合并陷阱（真机验证）**：ToAPIs 会把 `metadata` 合并进模型参数——曾把诊断字段
`metadata.mode: "text-to-video"` 发出去，覆盖了可灵的 `mode: std/pro` 导致 1201 报错。
metadata 里只准放官方文档定义的字段。

## 4. 生成执行流（`src/lib/video/generate.ts`）

提交 `POST /v1/videos/generations` → 轮询 `GET /v1/videos/generations/{id}`（5s 间隔，30min 上限）
→ 下载 mp4 到 `~/.lumos-media/` → `media_generations` 入库（type='video'，metadata 含
mode/duration/resolution/taskId/参考素材）。本地参考素材先经 `/v1/uploads/{images,videos}` 换 URL。

## 5. 相关代码位置

- **云端**：`lumos-web/src/lib/video-providers.ts`、`lumos-web/src/lib/quota/video-billing.ts`、
  `lumos-web/src/app/{admin/video-providers,api/admin/video-providers,api/quota/video/consume}`
- **桌面计费**：`src/lib/tools/video-gen-billing.ts`（HTTP 传输层与图片共用 `src/lib/tools/media-quota-client.ts`）
- **桌面生成**：`src/lib/video/{generate,model-profiles,model-profile-data,provider-defaults,provider-ui}.ts`
- **Agent 入口**：`src/lib/tools/video-gen-tool.ts`（`lumos-mcp-server.ts` 注册，提示词 `image-gen-hints.ts` 的 `VIDEO_GEN_IN_PROCESS_HINT`）
- **UI**：`src/components/settings/ImageProviderSection.tsx`（`VideoProviderSection` 复用）、`src/components/chat/VideoGenCard.tsx`、素材库 Gallery*

## 6. 已知缺口（非主链）

- 聊天内无「取消生成」按钮与实时进度条（`abortSignal`/`onProgress` 底层已支持，UI 未接）。
- 无视频封面帧提取、无转码；素材库直接播放 mp4。
- lumos-web 端 `lumos_video_usage` 尚无 admin 报表页（图片同样没有）。
