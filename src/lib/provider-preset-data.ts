import type { ProviderPreset, ProviderModelOption } from '@/types';
import { TEXT_GEN_PRESETS } from './provider-preset-text-gen';

/* ── 国产大模型默认模型列表 ────────────────────────────── */

const XIAOMI_MODELS: ProviderModelOption[] = [
  { value: 'mimo-v2-pro', label: 'MiMo v2 Pro' },
];

const DEEPSEEK_AGENT_MODELS: ProviderModelOption[] = [
  { value: 'deepseek-chat', label: 'DeepSeek V3' },
  { value: 'deepseek-reasoner', label: 'DeepSeek R1' },
];

const ZHIPU_AGENT_MODELS: ProviderModelOption[] = [
  { value: 'GLM-5-0313', label: 'GLM-5' },
  { value: 'GLM-4.7', label: 'GLM-4.7' },
];

const HUNYUAN_AGENT_MODELS: ProviderModelOption[] = [
  { value: 'hunyuan-2.0-thinking-20251109', label: 'Hunyuan 2.0 Thinking' },
  { value: 'hunyuan-2.0-instruct-20251111', label: 'Hunyuan 2.0 Instruct' },
];

const MINIMAX_AGENT_MODELS: ProviderModelOption[] = [
  { value: 'MiniMax-M2.7', label: 'MiniMax M2.7' },
  { value: 'MiniMax-M2.7-highspeed', label: 'MiniMax M2.7 Highspeed' },
  { value: 'MiniMax-M2.5', label: 'MiniMax M2.5' },
  { value: 'MiniMax-M2.5-highspeed', label: 'MiniMax M2.5 Highspeed' },
  { value: 'MiniMax-M2.1', label: 'MiniMax M2.1' },
  { value: 'MiniMax-M2.1-highspeed', label: 'MiniMax M2.1 Highspeed' },
  { value: 'MiniMax-M2', label: 'MiniMax M2' },
];

const DOUBAO_AGENT_MODELS: ProviderModelOption[] = [
  { value: 'doubao-seed-2.0-code', label: 'Doubao Seed 2.0 Code' },
  { value: 'doubao-seed-2.0-pro', label: 'Doubao Seed 2.0 Pro' },
  { value: 'doubao-seed-2.0-lite', label: 'Doubao Seed 2.0 Lite' },
  { value: 'doubao-seed-code', label: 'Doubao Seed Code' },
  { value: 'minimax-m2.5', label: 'MiniMax M2.5' },
  { value: 'glm-4.7', label: 'GLM 4.7' },
  { value: 'deepseek-v3.2', label: 'DeepSeek V3.2' },
  { value: 'kimi-k2.5', label: 'Kimi K2.5' },
];

/* ── Lumos Cloud (Pro 版专用) ─────────────────────────── */

const LUMOS_CLOUD_MODELS: ProviderModelOption[] = [
  { value: 'doubao-seed-2.0-lite', label: 'Doubao Seed 2.0 Lite' },
  { value: 'doubao-seed-2.0-pro', label: 'Doubao Seed 2.0 Pro' },
  { value: 'doubao-seed-2.0-code', label: 'Doubao Seed 2.0 Code' },
];

const LUMOS_CLOUD_PRESET: ProviderPreset = {
  id: 'lumos-cloud',
  name: 'Lumos Cloud',
  description: 'Lumos 内置云端服务，登录即可使用，无需自行配置 API Key。',
  provider_type: 'custom',
  api_protocol: 'anthropic-messages',
  capabilities: ['agent-chat'],
  provider_origin: 'system',
  auth_mode: 'api_key',
  base_url: 'http://api.miki.zj.cn',
  tags: ['主聊天', 'Agent', 'Lumos Cloud'],
  supported_modules: ['chat', 'workflow'],
  default_models: LUMOS_CLOUD_MODELS,
};

export { LUMOS_CLOUD_PRESET };

/* ── agent-chat 预设 ──────────────────────────────────── */

const AGENT_CHAT_PRESETS: ProviderPreset[] = [
  {
    id: 'claude-api-key',
    name: 'Claude API Key',
    description: '官方 Claude API 或企业 Anthropic 兼容网关。',
    provider_type: 'anthropic',
    api_protocol: 'anthropic-messages',
    capabilities: ['agent-chat'],
    provider_origin: 'preset',
    auth_mode: 'api_key',
    base_url: 'https://api.anthropic.com',
    tags: ['主聊天', 'Agent', 'Claude'],
    supported_modules: ['chat', 'workflow'],
  },
  {
    id: 'claude-local-auth',
    name: 'Claude 本地登录',
    description: '使用 Lumos 沙箱内的 Claude 登录态，无需手填 API Key。',
    provider_type: 'anthropic',
    api_protocol: 'anthropic-messages',
    capabilities: ['agent-chat'],
    provider_origin: 'preset',
    auth_mode: 'local_auth',
    base_url: 'https://api.anthropic.com',
    tags: ['主聊天', 'Agent', 'Claude'],
    supported_modules: ['chat', 'workflow'],
  },
  {
    id: 'bedrock-claude',
    name: 'Amazon Bedrock (Claude)',
    description: '通过 AWS Bedrock 接入 Claude 模型，需使用 Bedrock 端点和 API Key。',
    provider_type: 'bedrock',
    api_protocol: 'anthropic-messages',
    capabilities: ['agent-chat'],
    provider_origin: 'preset',
    auth_mode: 'api_key',
    base_url: '',
    notes: '请填写 Bedrock 的区域端点 URL，如 https://bedrock-runtime.us-east-1.amazonaws.com。',
    tags: ['主聊天', 'Agent', 'AWS'],
    supported_modules: ['chat', 'workflow'],
    requires_base_url: true,
  },
  {
    id: 'vertex-claude',
    name: 'Google Vertex AI (Claude)',
    description: '通过 GCP Vertex AI 接入 Claude 模型。',
    provider_type: 'vertex',
    api_protocol: 'anthropic-messages',
    capabilities: ['agent-chat'],
    provider_origin: 'preset',
    auth_mode: 'api_key',
    base_url: '',
    notes: '请填写 Vertex AI 端点 URL，如 https://us-east5-aiplatform.googleapis.com。',
    tags: ['主聊天', 'Agent', 'GCP'],
    supported_modules: ['chat', 'workflow'],
    requires_base_url: true,
  },
  {
    id: 'anthropic-compatible-agent',
    name: '其他 Anthropic 兼容端点',
    description: '适合自建中转或第三方 Anthropic Messages 兼容接口。需自行确认 Agent SDK 兼容性。',
    provider_type: 'custom',
    api_protocol: 'anthropic-messages',
    capabilities: ['agent-chat'],
    provider_origin: 'preset',
    auth_mode: 'api_key',
    base_url: '',
    notes: '请填写可兼容 Anthropic Messages 协议的 base URL。',
    tags: ['主聊天', '兼容端点'],
    supported_modules: ['chat', 'workflow'],
    requires_base_url: true,
  },

  // ── 国产大模型 Anthropic 兼容 ────────────────────────

  {
    id: 'xiaomi-mimo-agent',
    name: '小米 MiMo',
    description: '小米 MiMo 大模型，支持 Anthropic Messages 协议，可用于主聊天和工作流。',
    provider_type: 'custom',
    api_protocol: 'anthropic-messages',
    capabilities: ['agent-chat'],
    provider_origin: 'preset',
    auth_mode: 'api_key',
    base_url: 'https://api.xiaomimimo.com/anthropic',
    tags: ['主聊天', 'Agent', '国产'],
    supported_modules: ['chat', 'workflow'],
    default_models: XIAOMI_MODELS,
  },
  {
    id: 'deepseek-agent',
    name: 'DeepSeek',
    description: '深度求索大模型，支持 Anthropic Messages 协议。',
    provider_type: 'custom',
    api_protocol: 'anthropic-messages',
    capabilities: ['agent-chat'],
    provider_origin: 'preset',
    auth_mode: 'api_key',
    base_url: 'https://api.deepseek.com/anthropic',
    tags: ['主聊天', 'Agent', '国产'],
    supported_modules: ['chat', 'workflow'],
    default_models: DEEPSEEK_AGENT_MODELS,
  },
  {
    id: 'zhipu-agent',
    name: '智谱 AI',
    description: '智谱 GLM 系列大模型，支持 Anthropic Messages 协议。',
    provider_type: 'custom',
    api_protocol: 'anthropic-messages',
    capabilities: ['agent-chat'],
    provider_origin: 'preset',
    auth_mode: 'api_key',
    base_url: 'https://open.bigmodel.cn/api/anthropic',
    tags: ['主聊天', 'Agent', '国产'],
    supported_modules: ['chat', 'workflow'],
    default_models: ZHIPU_AGENT_MODELS,
  },
  {
    id: 'hunyuan-agent',
    name: '腾讯混元',
    description: '腾讯混元大模型，支持 Anthropic Messages 协议。',
    provider_type: 'custom',
    api_protocol: 'anthropic-messages',
    capabilities: ['agent-chat'],
    provider_origin: 'preset',
    auth_mode: 'api_key',
    base_url: 'https://api.hunyuan.cloud.tencent.com/anthropic',
    tags: ['主聊天', 'Agent', '国产'],
    supported_modules: ['chat', 'workflow'],
    default_models: HUNYUAN_AGENT_MODELS,
  },
  {
    id: 'minimax-agent',
    name: 'MiniMax',
    description: '稀宇科技 MiniMax 大模型，支持 Anthropic Messages 协议。国内/国际端点均可用。',
    provider_type: 'custom',
    api_protocol: 'anthropic-messages',
    capabilities: ['agent-chat'],
    provider_origin: 'preset',
    auth_mode: 'api_key',
    base_url: 'https://api.minimaxi.com/anthropic',
    notes: '国内端点 api.minimaxi.com；国际端点 api.minimax.io/anthropic。',
    tags: ['主聊天', 'Agent', '国产'],
    supported_modules: ['chat', 'workflow'],
    default_models: MINIMAX_AGENT_MODELS,
  },
  {
    id: 'doubao-agent',
    name: '豆包（火山引擎）',
    description: '字节跳动豆包大模型，通过火山引擎 Coding 端点接入，支持 Anthropic Messages 协议。',
    provider_type: 'custom',
    api_protocol: 'anthropic-messages',
    capabilities: ['agent-chat'],
    provider_origin: 'preset',
    auth_mode: 'api_key',
    base_url: 'https://ark.cn-beijing.volces.com/api/coding',
    tags: ['主聊天', 'Agent', '国产'],
    supported_modules: ['chat', 'workflow'],
    default_models: DOUBAO_AGENT_MODELS,
  },
];

/* ── 图片生成 预设 ────────────────────────────────────── */

const DOUBAO_IMAGE_MODELS: ProviderModelOption[] = [
  { value: 'doubao-seedream-3-0-t2i-250415', label: 'Seedream 3.0' },
  { value: 'doubao-seedream-4-5-251128', label: 'Seedream 4.5' },
];

const DASHSCOPE_IMAGE_MODELS: ProviderModelOption[] = [
  { value: 'wan2.7-image-pro', label: '万相 2.7 Pro（4K，思考模式）' },
  { value: 'wan2.7-image', label: '万相 2.7（快速）' },
];

const IMAGE_GEN_PRESETS: ProviderPreset[] = [
  {
    id: 'doubao-seedream',
    name: '豆包 Seedream（火山引擎）',
    description: '字节跳动豆包 Seedream 图片生成模型，通过火山引擎方舟平台接入。支持 1K/2K/4K 分辨率，guidance_scale 控制生成风格强度。',
    provider_type: 'volcengine',
    api_protocol: 'openai-compatible',
    capabilities: ['image-gen'],
    provider_origin: 'preset',
    auth_mode: 'api_key',
    base_url: 'https://ark.cn-beijing.volces.com/api/v3',
    notes: '在火山引擎控制台开通方舟服务后，填入 API Key 即可使用。',
    tags: ['图片', '补充能力', '国产'],
    supported_modules: ['image'],
    default_models: DOUBAO_IMAGE_MODELS,
  },
  {
    id: 'dashscope-wanxiang',
    name: '通义万相 2.7（阿里云）',
    description: '阿里云 DashScope 万相 2.7 图片生成模型。支持文生图、图片编辑、区域编辑、一致性组图，最高 4K 分辨率。',
    provider_type: 'dashscope',
    api_protocol: 'openai-compatible',
    capabilities: ['image-gen'],
    provider_origin: 'preset',
    auth_mode: 'api_key',
    base_url: 'https://dashscope.aliyuncs.com',
    notes: '在阿里云 DashScope 控制台获取 API Key。Pro 模型支持思考模式和 4K 输出。',
    tags: ['图片', '补充能力', '国产'],
    supported_modules: ['image'],
    default_models: DASHSCOPE_IMAGE_MODELS,
  },
  {
    id: 'gemini-image',
    name: 'Gemini 图片生成',
    description: '用于图片生成能力，不会进入主聊天模型列表。',
    provider_type: 'gemini-image',
    api_protocol: 'openai-compatible',
    capabilities: ['image-gen'],
    provider_origin: 'preset',
    auth_mode: 'api_key',
    base_url: '',
    notes: '可选填写自定义 Gemini 兼容地址；留空则走 SDK 默认地址。',
    tags: ['图片', '补充能力'],
    supported_modules: ['image'],
  },
];

/* ── 合并导出 ─────────────────────────────────────────── */

export const PROVIDER_PRESETS: ProviderPreset[] = [
  ...AGENT_CHAT_PRESETS,
  ...TEXT_GEN_PRESETS,
  ...IMAGE_GEN_PRESETS,
];
