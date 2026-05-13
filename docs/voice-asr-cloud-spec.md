# 语音 ASR 云端服务 — lumos-web 交付 Spec

> 给 lumos-web 仓库执行用。本仓库（Lumos 桌面端）已经做完桌面端那边
> （ProviderCapability 加 'speech'、provisionSpeechProviders、cloud-speech
> adapter、MCP 工具、skill、监控错误兜底）。这份 spec 写清云端那边要做的
> 6 个事情：DB 表、admin 后台、同步接口、ASR 代理 + 计费、临时上传、cron。

---

## 0. 固定假设（与桌面端 spec 保持一致）

1. 计费按秒 PAYG，DB 存 `NUMERIC(10,6)` 元/秒，UI 显示「元/分钟」（× 60 换算）
2. 火山使用**新版控制台**单 header `X-Api-Key`
3. 临时音频上传 URL 用 HMAC token 签名，30 分钟 TTL，火山首次拉取后立即标记可清理
4. 余额预扣按 30 秒 × price 预估，最终用 `audio_info.duration` 真实结算多退少补
5. 所有调用走 lumos-web 代理，密钥不下发桌面端

---

## 1. DB 迁移

```sql
CREATE TABLE lumos_speech_providers (
  id            BIGINT PRIMARY KEY AUTO_INCREMENT,
  name          VARCHAR(64) NOT NULL,
  provider_type VARCHAR(32) NOT NULL,         -- 'volcengine-asr-v2'
  api_key       TEXT NOT NULL,                 -- 加密（沿用现有 vault）
  resource_id   VARCHAR(64),                   -- volc.bigasr.auc / volc.seedasr.auc
  base_url      VARCHAR(255) DEFAULT 'https://openspeech.bytedance.com',
  model         VARCHAR(64) DEFAULT 'bigmodel',
  capabilities  JSON,                          -- ["speech"]
  price_per_second   DECIMAL(10,6) NOT NULL,
  min_charge_seconds INT DEFAULT 1,
  is_default    BOOLEAN DEFAULT FALSE,
  enabled       BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE speech_billing_log (
  id              BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id         BIGINT NOT NULL,
  provider_id     BIGINT NOT NULL,
  request_id      VARCHAR(64) NOT NULL UNIQUE,
  duration_sec    DECIMAL(10,3) NOT NULL,
  amount          DECIMAL(10,6) NOT NULL,
  status          VARCHAR(16) NOT NULL,       -- 'success' | 'failed' | 'silent'
  failure_reason  TEXT,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user_created (user_id, created_at)
);
```

种子默认行（迁移文件直接 INSERT）：

```sql
INSERT INTO lumos_speech_providers
  (name, provider_type, api_key, resource_id, base_url, model, capabilities,
   price_per_second, min_charge_seconds, is_default, enabled)
VALUES
  ('火山引擎 - 录音文件识别 2.0', 'volcengine-asr-v2',
   '<填火山 API Key>', 'volc.seedasr.auc',
   'https://openspeech.bytedance.com', 'bigmodel', '["speech"]',
   0.000400, 1, TRUE, TRUE);
-- 0.000400 元/秒 = 0.024 元/分钟（参考火山官网价，按实际更新）
```

---

## 2. Admin 后台 `/admin/speech-providers`

参照 `/admin/image-providers` 的实现，结构基本一致：

- **列表页**：分页表格（name / provider_type / price / is_default / enabled / 操作）
- **新增 / 编辑 dialog**：
  - name、provider_type（dropdown：volcengine-asr-v2）、resource_id（dropdown：volc.bigasr.auc / volc.seedasr.auc）、base_url、model、api_key（半遮蔽编辑，保存才完整覆盖）
  - **price_per_minute** 数字输入框（用户视角是分钟价），DB 存时 ÷ 60 写入 price_per_second；读取展示时 × 60 反算
  - min_charge_seconds（默认 1）
  - is_default switch（设置 true 时把其他记录的 is_default 设为 false，强制单选）
  - enabled switch
- **保存后副作用**：自动同步 new-api ratio（参照 chat 的 autosync 逻辑，记忆里的 `project_chat_pricing_autosync.md`），key 用 `asr:<provider_type>:<model>`

---

## 3. 同步接口 `GET /api/cloud/speech-providers`

桌面端在登录 / 拉用户信息时一并要这个列表。返回结构：

```json
{
  "speech_providers": [
    {
      "id": "1",
      "is_default": true,
      "name": "火山引擎 - 录音文件识别 2.0",
      "provider_type": "volcengine-asr-v2",
      "price_per_second": 0.0004,
      "resource_id": "volc.seedasr.auc",
      "default_model": "bigmodel"
    }
  ]
}
```

**严格脱敏**：不下发 api_key、不下发 base_url（桌面端永远调 lumos-web 代理而不是火山）。

桌面端处理：本仓库 `provisionSpeechProviders` 已经按这个 schema 写好。lumos-web 把 `speech_providers` 字段加到 `/api/auth/me` 和 `/api/auth/login` 的返回里就直接接通。

---

## 4. ASR 代理 + 计费 `POST /api/cloud/speech/transcribe`

**请求**：

```json
{
  "remote_provider_id": 1,
  "audio_url": "https://lumos-web.example.com/api/cloud/audio-temp/abc?token=...",
  "options": {
    "language": "zh-CN",
    "enable_punc": true,
    "enable_itn": true,
    "show_utterances": false
  }
}
```

**流程**：

1. **登录验证**（沿用现有 user session 中间件）
2. **provider 查找**：`SELECT * FROM lumos_speech_providers WHERE id = ? AND enabled = 1`，404 不存在 / 未启用
3. **余额预估扣**：`預估 = 30 × price_per_second`，调 new-api 检查余额 ≥ 預估，否则返回：
   ```json
   { "ok": false, "error": "INSUFFICIENT_BALANCE", "message": "账户余额不足", "required_min": 0.012 }
   ```
4. **submit 任务到火山**：
   ```http
   POST https://openspeech.bytedance.com/api/v3/auc/bigmodel/submit
   X-Api-Key: <provider.api_key>
   X-Api-Resource-Id: <provider.resource_id>
   X-Api-Request-Id: <uuid>
   X-Api-Sequence: -1
   Content-Type: application/json

   {
     "user": { "uid": "<lumos_user_id>" },
     "audio": { "format": "wav", "url": "<audio_url>" },
     "request": {
       "model_name": "bigmodel",
       "enable_itn": true,
       "enable_punc": true
     }
   }
   ```
5. **轮询 query**（每 2 秒，最多 5 分钟）：
   ```http
   POST https://openspeech.bytedance.com/api/v3/auc/bigmodel/query
   X-Api-Key: <provider.api_key>
   X-Api-Resource-Id: <provider.resource_id>
   X-Api-Request-Id: <same uuid>
   ```
   响应 header `X-Api-Status-Code`：
   - `20000000` → 完成，body 含 result + audio_info.duration
   - `20000001 / 20000002` → 处理中，继续轮询
   - `20000003` → 静音音频
   - 其他 → 错误，停止
6. **真实结算**：
   ```
   duration_sec = result.audio_info.duration / 1000
   amount = max(duration_sec, provider.min_charge_seconds) × provider.price_per_second
   ```
   静音情况：amount = 0
7. **扣 new-api 余额**：调现有的 quota 接口，业务标记 `model='asr:<provider_type>:<model>'`
8. **写 speech_billing_log**：必含 user_id / provider_id / request_id（火山 X-Api-Request-Id）/ duration_sec / amount / status / failure_reason
9. **返回**：
   ```json
   {
     "ok": true,
     "text": "你好我想问一下这件商品还有现货吗",
     "duration_seconds": 4.2,
     "charged_amount": 0.0017,
     "request_id": "67ee89ba-...",
     "provider_type": "volcengine-asr-v2"
   }
   ```
   静音：`{ "ok": true, "text": "", "duration_seconds": 0, "charged_amount": 0, "status": "silent" }`
   失败：`{ "ok": false, "error": "<火山错误码或描述>" }`，并写入 log status='failed'

**重试策略**：火山 query 返回 5xx / 网络抖动时最多重试 3 次（exponential backoff 1s/2s/4s）；submit 失败不重试（避免重复任务）。

---

## 5. 临时音频上传

### `POST /api/cloud/audio-temp`

**请求**：优先使用 multipart-form-data 原始音频二进制；兼容 JSON `{ base64, mime_type, name? }` 旧调用。Lumos 临时上传层不设置 25MB 这类业务上限；反向代理也应取消 `client_max_body_size` 硬限制。音频时长 / 大小仍可能受实际 ASR 服务商官方限制约束。

**处理**：
1. 登录验证
2. 写到 `/var/lumos-web/uploads/audio/{uuid}.{ext}`，权限 0600
3. 生成 HMAC token：`hmac_sha256(secret = LUMOS_AUDIO_TEMP_SECRET, message = uuid + expire_ts).hex().slice(0, 32)`
4. 返回：
   ```json
   {
     "url": "https://lumos-web.example.com/api/cloud/audio-temp/{uuid}?token=<hmac>&exp=<unix_ts>",
     "expires_in": 1800
   }
   ```

### `GET /api/cloud/audio-temp/{uuid}`

**处理**：
1. 校验 query token + exp（HMAC 校验 + 时间窗内）
2. 校验文件存在
3. **stream** 文件返回（不能 readFileSync 全量加载，火山可能要拉大文件）
4. 成功 200 后**立即标记可清理**：把文件 mtime 设到 `now - 30min`，让 cron 立刻收走

不需要鉴权 user session（火山的服务器没法带 user cookie），靠 HMAC + TTL 保护。

### Cron 清理

每 10 分钟跑：
```bash
find /var/lumos-web/uploads/audio -type f -mmin +30 -delete
```

或 Node 任务：

```ts
import { schedule } from 'node-cron';
schedule('*/10 * * * *', () => cleanupExpiredAudio('/var/lumos-web/uploads/audio', 30 * 60 * 1000));
```

---

## 6. 桌面端的合作姿势（已实现，仅参考）

桌面端 cloud-speech adapter（`src/lib/im/core/asr-adapters/cloud-speech.ts`）调用流程：

1. 拿音频 bytes
2. POST `/api/cloud/audio-temp` 拿临时 URL
3. POST `/api/cloud/speech/transcribe` 带 `remote_provider_id`（来自 `lumos_cloud_speech_providers_map` 反查）+ `audio_url`
4. 返回结构 `{ text, duration_seconds, charged_amount, request_id, provider }`

**桌面端不直接调火山**，永远走 lumos-web 代理。

---

## 7. 验收

| # | 项 | 验法 |
|---|---|---|
| C1 | admin 能新增/编辑/删除/设默认 speech provider | 浏览器手动 |
| C2 | 价格变更后 new-api ratio 自动同步 | 改价后 SELECT new-api ratio 表 |
| C3 | `/api/auth/me` 返回 speech_providers 数组 | curl 看响应 |
| C4 | 桌面端登录后 `lumos_cloud_speech_providers_map` 写入 | sqlite3 ~/.lumos/lumos.db |
| C5 | `/api/cloud/audio-temp` 上传 + `/api/cloud/audio-temp/{uuid}?token=...` 取回，stream 完整 | 端到端 curl |
| C6 | HMAC token 错误 / 过期 → 返回 403 | 改 token 试 |
| C7 | `/api/cloud/speech/transcribe` 真把火山 result 转成 text 返回 | 真音频 e2e |
| C8 | 余额不足直接 INSUFFICIENT_BALANCE 不上报火山 | 测试账号置 0 |
| C9 | 静音音频 status=silent + amount=0 | 上传纯静音 wav |
| C10 | speech_billing_log 每次调用都写一行 | 调用后 SELECT |
| C11 | 30 分钟过期后 cron 删除上传文件 | 等 30min 看 /var/lumos-web/uploads/audio |

---

## 8. 不在范围

- 抖音 / 其他 ASR provider
- 实时流式 ASR
- 客户端直接调火山（永远 proxy 强制）
- 桌面端添加 custom speech provider
