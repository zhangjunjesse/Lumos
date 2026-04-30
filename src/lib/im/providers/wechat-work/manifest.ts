/**
 * WeChat Work (企业微信) Provider — Manifest
 *
 * 通过企业微信「自建应用 + OpenClaw 集成」接入。出站走官方 cgi-bin OpenAPI，
 * 入站消息需要在企业微信后台配置 Webhook 回调（M5 范围尚未实现接收解密链路）。
 */

import type { IMProviderManifest } from '../../core/types';

export const wechatWorkManifest: IMProviderManifest = {
  id: 'wechat-work',
  label: '企业微信',
  description: '企业微信自建应用（OpenAPI 出站，Webhook 入站；M5 仅出站可用）',
  docsUrl: 'https://developer.work.weixin.qq.com/document/path/90236',
  configSchema: [
    {
      key: 'corp_id',
      label: 'CorpID',
      type: 'string',
      required: true,
      placeholder: 'ww0000000000000000',
      description: '企业 ID，企业微信后台「我的企业」可获取',
    },
    {
      key: 'agent_id',
      label: 'AgentID',
      type: 'string',
      required: true,
      placeholder: '1000002',
      description: '自建应用 AgentID',
    },
    {
      key: 'corp_secret',
      label: 'Corp Secret',
      type: 'secret',
      required: true,
      description: '自建应用 Secret，用于换取 access_token',
    },
    {
      key: 'callback_token',
      label: 'Callback Token',
      type: 'secret',
      required: false,
      description: 'Webhook 回调 Token（接收消息用，M5 暂未启用解密链路）',
    },
    {
      key: 'callback_aes_key',
      label: 'Callback EncodingAESKey',
      type: 'secret',
      required: false,
      description: 'Webhook 回调消息加解密密钥（M5 暂未启用）',
    },
    {
      key: 'api_base',
      label: 'API Base URL',
      type: 'url',
      required: false,
      default: 'https://qyapi.weixin.qq.com',
      description: '企业微信 OpenAPI 网关，私有化部署可改',
    },
  ],
  capabilities: {
    chatTypes: ['direct', 'group'],
    media: false,
    reactions: false,
    threads: false,
    edit: false,
    commands: false,
    targetDirectory: false, // M5 不暴露通讯录列表
    streamingPreview: false,
  },
};
