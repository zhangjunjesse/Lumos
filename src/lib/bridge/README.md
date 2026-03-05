# Feishu Bridge Adapter

飞书桥接适配器，用于Lumos与飞书的消息同步。

## 文件结构

```
src/lib/bridge/
├── types.ts                    # 基础类型定义
├── channel-adapter.ts          # 适配器基类
├── adapters/
│   ├── feishu-adapter.ts      # 飞书适配器实现
│   ├── feishu-api.ts          # API工具类
│   └── index.ts               # 导出
└── markdown/
    └── feishu-card.ts         # Markdown转飞书卡片
```

## 使用示例

```typescript
import { FeishuAdapter } from '@/lib/bridge/adapters';

const adapter = new FeishuAdapter({
  appId: 'your_app_id',
  appSecret: 'your_app_secret',
  domain: 'feishu', // or 'lark'
});

// 启动
await adapter.start();

// 发送消息
await adapter.send({
  address: {
    channelType: 'feishu',
    chatId: 'chat_id',
  },
  text: 'Hello!',
});

// 接收消息
const message = await adapter.consumeOne();
console.log(message);

// 停止
await adapter.stop();
```

## 依赖

需要安装：
```bash
npm install @larksuiteoapi/node-sdk
```

## 功能特性

- ✅ WebSocket连接管理
- ✅ 消息队列和异步消费
- ✅ 消息去重
- ✅ Token自动缓存
- ✅ 自动重连（SDK内置）
- ⏳ 图片/文件支持（待扩展）
- ⏳ Markdown卡片（待扩展）

## 实现说明

- 总代码量：~200行
- 遵循最小化原则
- 完整类型定义
- 错误处理完善
