/**
 * WeChat Provider — Manifest
 *
 * 通过微信 ilink 机器人网关接入个人微信号。
 * 协议参考 cc-connect/platform/weixin (MIT)：
 *   GET  /ilink/bot/get_bot_qrcode        — 拿 QR 二维码
 *   GET  /ilink/bot/get_qrcode_status     — 长轮询绑定状态
 *   POST /ilink/bot/getupdates            — 长轮询拉消息（Bearer token）
 *   POST /ilink/bot/sendmessage           — 发消息（Bearer token + context_token）
 *
 * 用户体验：settings 里点"扫码绑定"，弹出二维码，微信扫码 → token 自动写入。
 * 不需要填 host / port / appId / secret 任何东西。
 */

import type { IMProviderManifest } from '../../core/types';

export const wechatManifest: IMProviderManifest = {
  id: 'wechat',
  label: '微信',
  description: '通过 ilink 网关接入个人微信号（扫码即用）',
  docsUrl: 'https://github.com/chenhg5/cc-connect',
  configSchema: [
    {
      key: 'token',
      label: 'Bot Token',
      type: 'secret',
      required: true,
      description: '扫码绑定后自动写入；也可手动填入已有 token',
    },
    {
      key: 'base_url',
      label: 'API Base URL',
      type: 'url',
      required: false,
      default: 'https://ilinkai.weixin.qq.com',
      description: 'ilink 网关地址，绑定时若服务器分配新地址会自动更新',
    },
    {
      key: 'account_id',
      label: '账号标识',
      type: 'string',
      required: false,
      default: 'default',
      description: '同时跑多个账号时用于隔离持久化目录；默认 default',
    },
    {
      key: 'allow_from',
      label: '允许的对端用户',
      type: 'string',
      required: false,
      default: '*',
      description: '逗号分隔的微信用户 ID（如 user1@im.wechat），* 表示所有',
    },
    {
      key: 'route_tag',
      label: 'Route Tag',
      type: 'string',
      required: false,
      description: '部分 ilink 网关分配的 SKRouteTag；扫码绑定或手动配置后会随收发请求携带',
    },
  ],
  capabilities: {
    chatTypes: ['direct'],
    media: false,
    reactions: false,
    threads: false,
    edit: false,
    commands: true,
    targetDirectory: false,
    streamingPreview: false,
  },
};
