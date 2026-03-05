# Bridge API 接口文档

## 1. 创建绑定

**POST /api/bridge/bindings**

创建会话与飞书的绑定，生成二维码供用户扫码。

**请求体**：
```json
{
  "sessionId": "session_123",
  "sessionTitle": "我的对话"
}
```

**响应**：
```json
{
  "bindingId": "abc123",
  "token": "xyz789",
  "qrCode": "data:image/png;base64,...",
  "callbackUrl": "http://localhost:3000/api/bridge/feishu/callback?token=xyz789"
}
```

## 2. 查询绑定状态

**GET /api/bridge/bindings/:binding_id**

查询绑定状态，用于前端轮询检查绑定是否完成。

**响应**：
```json
{
  "id": "abc123",
  "sessionId": "session_123",
  "chatId": "oc_xxx",
  "status": "active",
  "createdAt": "2026-03-05T03:00:00.000Z"
}
```

**状态值**：
- `pending` - 等待用户扫码
- `active` - 已激活
- `paused` - 已暂停

## 3. 飞书回调

**POST /api/bridge/feishu/callback?token=xxx**

处理用户扫码后的回调，创建飞书群组并激活绑定。

**响应**：
```json
{
  "chatId": "oc_xxx",
  "shareLink": "https://applink.feishu.cn/..."
}
```
