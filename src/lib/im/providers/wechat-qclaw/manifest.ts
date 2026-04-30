/**
 * WeChat (QClaw) Provider — Manifest
 *
 * QClaw 是腾讯出品的 OpenClaw 微信接入桥（个人微信 ClawBot）。
 * 用户在自己机器上运行 QClaw，lumos 通过 QClaw 暴露的 HTTP/WS API 收发消息。
 *
 * 注意：QClaw 公开技术文档不含 API 规范，本 provider 基于 OpenClaw 通用协议假设
 * （HTTP REST 出站 + WebSocket 入站）。各 endpoint path 都通过 configSchema 暴露，
 * 用户可根据本地实际 QClaw 实例调整。
 */

import type { IMProviderManifest } from '../../core/types';

export const wechatQclawManifest: IMProviderManifest = {
  id: 'wechat-qclaw',
  label: '微信 (QClaw)',
  description: '通过腾讯 QClaw / ClawBot 接入个人微信',
  docsUrl: 'https://qclaw.qq.com/docs/206087648449069056.html',
  configSchema: [
    {
      key: 'qclaw_host',
      label: 'QClaw 服务地址',
      type: 'url',
      required: true,
      default: 'http://localhost:8080',
      description: '本机或局域网内运行的 QClaw 服务地址',
    },
    {
      key: 'bot_id',
      label: 'Bot ID',
      type: 'string',
      required: true,
      placeholder: '在 QClaw 后台创建机器人时获得',
    },
    {
      key: 'bot_secret',
      label: 'Bot Secret',
      type: 'secret',
      required: true,
      description: 'Bot 对应的 Secret，用于 Bearer 鉴权',
    },
    {
      key: 'transport',
      label: '连接方式',
      type: 'enum',
      required: false,
      default: 'websocket',
      enumValues: [
        { value: 'websocket', label: 'WebSocket 长连接' },
        { value: 'longpoll', label: 'HTTP 长轮询' },
      ],
      description: '入站事件订阅方式',
    },
    {
      key: 'send_path',
      label: '发送消息 path',
      type: 'string',
      required: false,
      default: '/api/messages/send',
      description: '出站消息接口的相对路径，根据 QClaw 实例调整',
    },
    {
      key: 'events_path',
      label: '事件订阅 path',
      type: 'string',
      required: false,
      default: '/api/events',
      description: 'WebSocket / 长轮询订阅 path',
    },
    {
      key: 'contacts_path',
      label: '联系人列表 path',
      type: 'string',
      required: false,
      default: '/api/contacts',
      description: '获取群聊 / 联系人列表的 path',
    },
    {
      key: 'health_path',
      label: '健康检查 path',
      type: 'string',
      required: false,
      default: '/api/health',
      description: '探活接口路径',
    },
  ],
  capabilities: {
    chatTypes: ['direct', 'group'],
    media: false,
    reactions: false,
    threads: false,
    edit: false,
    commands: false,
    targetDirectory: true,
    streamingPreview: false,
  },
};
