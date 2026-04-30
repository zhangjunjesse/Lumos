/**
 * Feishu Provider — Manifest
 *
 * 这是 Feishu 这个 IM 的"目录"。改这里 = UI/校验/CLI 自动跟上。
 * 不在这里的字段不会出现在 settings 里。
 */

import type { IMProviderManifest } from '../../core/types';

export const DEFAULT_FEISHU_OAUTH_SCOPES = [
  'offline_access',
  'wiki:wiki',
  'docx:document',
  'docx:document.block:convert',
  'drive:drive',
  'mail:user_mailbox.message:send',
  'contact:user.base:readonly',
  'contact:user.email:readonly',
].join(' ');

export const feishuManifest: IMProviderManifest = {
  id: 'feishu',
  label: 'Feishu',
  description: '飞书 / Lark 企业即时通讯',
  docsUrl: 'https://open.feishu.cn/document',
  configSchema: [
    {
      key: 'app_id',
      label: 'App ID',
      type: 'string',
      required: true,
      placeholder: 'cli_xxx',
      description: '在飞书开放平台创建的应用 ID',
    },
    {
      key: 'app_secret',
      label: 'App Secret',
      type: 'secret',
      required: true,
      description: '应用密钥；保存后服务端 mask 显示',
    },
    {
      key: 'domain',
      label: 'Domain',
      type: 'enum',
      required: false,
      default: 'feishu',
      enumValues: [
        { value: 'feishu', label: '飞书 (中国大陆)' },
        { value: 'lark', label: 'Lark (海外)' },
      ],
      description: '飞书国内 / Lark 海外不同接入域',
    },
    {
      key: 'redirect_uri',
      label: 'OAuth Redirect URI',
      type: 'url',
      required: false,
      placeholder: 'http://localhost:43127/api/feishu/auth/callback',
      description: 'OAuth 回调地址；留空时按当前 origin 自动生成（OAuth 登录时使用）',
    },
    {
      key: 'oauth_scopes',
      label: 'OAuth Scopes',
      type: 'string',
      required: false,
      default: DEFAULT_FEISHU_OAUTH_SCOPES,
      description: 'OAuth 授权范围，空格分隔',
    },
  ],
  capabilities: {
    // M7 起开启 commands（IMCommandHandler 通过内置命令实现）。
    // streamingPreview 仍待后续 milestone。
    chatTypes: ['direct', 'group'],
    media: false,
    reactions: false,
    threads: false,
    edit: false,
    commands: true,
    targetDirectory: true,
    streamingPreview: false,
  },
};
