# 图片服务商系统 — 实际架构

> 本文档记录桌面端图片生成服务商的**当前实际**架构,不是理想设计。
> 截至 2026-04-22。

---

## 1. 数据流总览

```
[lumos-web admin]                [desktop (~/.lumos/lumos.db)]            [Agent 生图]
       │                                   │                                    │
       ▼ (管理员维护)                        │                                    │
lumos_image_providers                       │                                    │
       │                                    │                                    │
       └─── 登录时 provision ───────────────▶ api_providers                       │
                                            + settings.provider_override:image   │
                                            + settings.lumos_cloud_             │
                                              image_providers_map                │
                                            ( model_override:image 不动 )         │
                                            │                                    │
                                            └────── resolveBillingTarget ───────▶ 调远端 API
                                                    (读端校验 override)
                                            ▲                                    │
                                            │                                    │
                                            └───── /api/quota/image/consume ◀────┘
                                                   (扣 new-api 余额,整数配额)
```

---

## 2. 权威来源

- **云端**:`lumos-web` 数据库的 `lumos_image_providers` 表,管理员在 `/admin/image-providers` 维护。
- **桌面端**:登录时从云端拉取并同步到本地 `api_providers` 表。桌面 DB 是**只读镜像**,不是权威源。

---

## 3. 三个关键 settings key

| key | 值 | 谁写 | 谁读 |
|---|---|---|---|
| `provider_override:image` | 本地 `api_providers.id` | provisioner(登录时)、用户(仅 Pro + media 权限开启时) | `resolveProviderForCapability` |
| `model_override:image` | 模型 value(`provider.model_catalog[].value`) | 用户(仅 Pro + media 权限开启时) | `resolveModelForProvider`,**读时校验** |
| `lumos_cloud_image_providers_map` | JSON:`{remote_id: local_id}` | provisioner | provisioner(diff 失效 provider)、billing(反查 remote_id 上报云端) |

---

## 4. Provisioner 同步规则

`src/lib/cloud/provisioner.ts :: provisionImageProviders(configs)`

1. **入参空数组** → 清空 map、删除所有云下发的 provider、删除 `provider_override:image`。
2. **入参非空**:
   - 按 `remote_id` 一对一 upsert 到 `api_providers`(`provider_origin=system`)。
   - 原 map 中但新列表没有的 → 删除(orphan 清理)。
   - 写入新 map。
   - 维护 `provider_override:image`(用户选择优先, `is_default` 仅做兜底):
     - 旧值仍指向 map 内合法 local id → 保留(用户的手动切换不被周期同步覆盖)。
     - 否则有 `is_default=true` 的 config → 用它兜底(全新用户 / 旧值失效场景)。
     - 否则 → 清空, 让 `resolveProviderForCapability` 报错提醒用户去选择。
3. **`model_override:image` 从不被 provisioner 动**。这是脱钩的根源,由读端校验兜底。

---

## 5. 读端解析(Agent 调用生图时)

`src/lib/tools/image-gen-billing.ts :: resolveBillingTarget`

```
1. resolveProviderForCapability('image-gen') 读 provider_override:image
   → 拿到 ApiProvider
2. resolveModelForProvider(provider):
   a) 解析 provider.model_catalog(JSON 数组)
   b) 读 model_override:image
   c) 如果 override 在 catalog 里 → 用 override
   d) 否则 → fallback 到 catalog[0]   ← 自愈点
3. getRemoteImageProviderId(db, provider.id) 反查 map 拿 remote_id
4. 返回 { provider, remoteProviderId, model }
```

**自愈机制**:用户 `model_override:image` 可能指向已不存在的模型(provisioner 换了 provider/catalog,但没清 model_override)。读端在步骤 2c 校验,失败就走 2d,不会炸。

---

## 6. 计费链路

1. `image-gen-tool.ts` 先调 `consumeRemoteQuota`(POST `lumos-web/api/quota/image/consume`,`action: consume`)。
2. `lumos-web` 查该 provider + model 的 `price_per_image`(整数配额,500000 = ¥1),从用户 `tokens.remain_quota` 扣除 `price × count`。
3. 本地生图成功 → 无动作。失败 → `refundRemoteQuota` 退款(best-effort)。
4. 整条链路**纯整数算术**,不用浮点。admin UI 输入元(支持 2 位小数),保存时乘 500000 转配额。

---

## 7. End-user 可见性

| 版本 | 用户能否选图片服务商 |
|---|---|
| Open 版 | 可以,`SettingsLayout` 永远渲染 `ImageProviderSection` |
| Pro 版,`allow_custom_provider:media = 0`(默认) | **不能**,设置页无图片服务商板块,全由 provisioner 代管 |
| Pro 版,`allow_custom_provider:media = 1` | 可以,和 Open 版一样 |

`allow_custom_provider:media` 由云端下发(登录时),admin 可以按账号开关。

---

## 8. 已知设计缺口

### 8.1 `model_override:image` 是独立 key,非外键

`model_override` 和 `provider_override` 是两个平行的 settings 条目,但语义上 model 必须属于 provider.catalog。provisioner 换 provider 时不碰 model,导致脱钩。目前靠**读端校验**兜底(§5 自愈点)。

如果未来要根治,有两条路:
- **写端同步**:provisioner 换 provider 时,如果新 catalog 里没有当前 model,清掉 model_override。
- **合成单 key**:`override:image = provider_id:model`,读时一次性解析。

两者都是合规重构,但目前的读端校验已经把故障面堵死,不急。

### 8.2 Orphan system provider 清理依赖 map

如果 `lumos_cloud_image_providers_map` 意外丢失(比如手动清了 settings 表),provisioner 就认不出哪些 `api_providers` 是它以前创建的,无法清理 orphan。目前没兜底。

### 8.3 Preset 服务商可被用户修改

`api_providers.provider_origin = 'preset'` 的记录,用户编辑后仍然是 `preset`,没迁移到 `custom`。严格讲 preset 应该是模板(不可改),改后应变成 custom 实例。这是更大范围的 provider 系统问题,不局限于图片。

---

## 9. 相关代码位置

- **云端管理 UI**:`lumos-web/src/app/admin/image-providers/{page,editor-dialog}.tsx`
- **云端 API**:`lumos-web/src/app/api/admin/image-providers/route.ts`、`lumos-web/src/lib/quota/image-billing.ts`
- **桌面 provisioner**:`src/lib/cloud/provisioner.ts`
- **桌面读端**:`src/lib/tools/image-gen-billing.ts`、`src/lib/provider-resolver.ts`
- **桌面用户 UI**:`src/components/settings/ImageProviderSection.tsx`
- **Agent 入口**:`src/lib/tools/image-gen-tool.ts`
- **Schema**:`lumos-web/src/lib/db/schema.ts`(`lumos_image_providers`、`lumos_image_usage`)
