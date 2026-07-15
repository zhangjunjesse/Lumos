'use client';

import { useRef, useState, useCallback, useEffect, useMemo, type KeyboardEvent, type FormEvent } from 'react';
import { HugeiconsIcon } from "@hugeicons/react";
import {
  At,
  HelpCircleIcon,
  ArrowDown01,
  ArrowUp,
  CommandIcon,
  Add,
  Cancel,
  Delete,
  Coins,
  ZipIcon,
  Stethoscope,
  Edit,
  SearchList01Icon,
  Brain,
  Stop,
  Globe,
} from "@hugeicons/core-free-icons";
import { cn } from '@/lib/utils';
import { formatYuanPerMtok } from '@/lib/pricing';
import { isPro } from '@/lib/edition';
import { useProAuthSelector } from '@/hooks/useProAuth';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/i18n';
import { Button } from '@/components/ui/button';
import {
  buildDefaultAdvancedValues,
  ImageGenOptionsFields,
  type ImageProviderUiConfigResponse,
} from './ImageGenOptionsFields';
import { buildImageGenerationSystemPrompt } from '@/lib/image/provider-defaults';
import {
  DEFAULT_PROVIDER_MODEL_OPTIONS,
  doesResolvedModelMatchRequested,
} from '@/lib/model-metadata';
import {
  CHAT_DEFAULT_MODEL_STORAGE_KEY,
  CHAT_DEFAULT_PROVIDER_STORAGE_KEY,
  LEGACY_CHAT_DEFAULT_MODEL_STORAGE_KEY,
  LEGACY_CODEPILOT_MODEL_STORAGE_KEY,
  filterVisibleChatProviderGroups,
  resolveChatProviderModelSelection,
} from '@/lib/chat/provider-selection';
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputTools,
  PromptInputButton,
  PromptInputSubmit,
  usePromptInputAttachments,
  type PromptFileItem,
} from '@/components/ai-elements/prompt-input';
import type { ChatStatus } from 'ai';
import type { ChatKnowledgeOptions, FileAttachment, KnowledgeOverrides, ProviderModelGroup } from '@/types';
import { KnowledgeMenuPanel } from './KnowledgeMenuPanel';
import { nanoid } from 'nanoid';
import {
  inferAudioMimeFromFilename,
  isAudioFileLike,
} from '@/lib/chat/audio-attachments';

// Accepted file types for upload
const ACCEPTED_FILE_TYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'application/pdf',
  'text/*',
  // Audio: prefer native file paths in Electron; fall back to upload metadata
  // when the browser cannot expose a path. The backend injects the real
  // transcribe_audio instruction after files are persisted.
  'audio/*',
  '.md', '.json', '.csv', '.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs',
  '.m4a', '.mp3', '.wav', '.ogg', '.aac', '.amr', '.silk', '.flac', '.webm',
].join(',');

// Max file sizes
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;  // 5MB
const MAX_DOC_SIZE = 10 * 1024 * 1024;   // 10MB

interface MessageInputProps {
  onSend: (
    content: string,
    files?: FileAttachment[],
    systemPromptAppend?: string,
    displayOverride?: string,
    knowledgeOptions?: ChatKnowledgeOptions,
  ) => void;
  onCommand?: (command: string) => void;
  onStop?: () => void;
  disabled?: boolean;
  isStreaming?: boolean;
  sessionId?: string;
  modelName?: string;
  resolvedModelName?: string;
  onModelChange?: (model: string) => void;
  providerId?: string;
  onProviderModelChange?: (providerId: string, model: string) => void;
  workingDirectory?: string;
  initialKnowledgeEnabled?: boolean;
  initialKnowledgeOptions?: ChatKnowledgeOptions;
  onKnowledgeOptionsChange?: (options: ChatKnowledgeOptions) => void;
  onInputFocus?: () => void;
  fullWidth?: boolean;
  providerModelsEndpoint?: string;
  /** 团队会话:当前绑定的团队(工具栏与模型选择器同行展示) */
  teamId?: string;
  teamName?: string;
  /** 空会话可换队时传入;会话已开始则不传(只显示徽标不可改) */
  onTeamChange?: (teamId: string, teamName: string) => void;
}

interface PopoverItem {
  label: string;
  value: string;
  description?: string;
  descriptionKey?: TranslationKey;
  builtIn?: boolean;
  immediate?: boolean;
  installedSource?: "agents" | "claude";
  source?: "global" | "project" | "plugin" | "installed";
  icon?: typeof CommandIcon;
}

interface CommandBadge {
  command: string;
  label: string;
  description: string;
  isSkill: boolean;
  installedSource?: "agents" | "claude";
}

type PopoverMode = 'file' | 'skill' | null;

// Expansion prompts for CLI-only commands (not natively supported by SDK).
// SDK-native commands (/compact, /init, /review) are sent as-is — the SDK handles them directly.
const COMMAND_PROMPTS: Record<string, string> = {
  '/doctor': 'Run diagnostic checks on this project. Check system health, dependencies, configuration files, and report any issues.',
  '/terminal-setup': 'Help me configure my terminal for optimal use with Claude Code. Check current setup and suggest improvements.',
  '/memory': 'Show the current CLAUDE.md project memory file and help me review or edit it.',
};

const BUILT_IN_COMMANDS: PopoverItem[] = [
  { label: 'help', value: '/help', description: 'Show available commands and tips', descriptionKey: 'messageInput.helpDesc', builtIn: true, immediate: true, icon: HelpCircleIcon },
  { label: 'clear', value: '/clear', description: 'Clear conversation history', descriptionKey: 'messageInput.clearDesc', builtIn: true, immediate: true, icon: Delete },
  { label: 'cost', value: '/cost', description: 'Show token usage statistics', descriptionKey: 'messageInput.costDesc', builtIn: true, immediate: true, icon: Coins },
  { label: 'compact', value: '/compact', description: 'Compress conversation context', descriptionKey: 'messageInput.compactDesc', builtIn: true, icon: ZipIcon },
  { label: 'doctor', value: '/doctor', description: 'Diagnose project health', descriptionKey: 'messageInput.doctorDesc', builtIn: true, icon: Stethoscope },
  { label: 'init', value: '/init', description: 'Initialize CLAUDE.md for project', descriptionKey: 'messageInput.initDesc', builtIn: true, icon: Edit },
  { label: 'review', value: '/review', description: 'Review code quality', descriptionKey: 'messageInput.reviewDesc', builtIn: true, icon: SearchList01Icon },
  { label: 'terminal-setup', value: '/terminal-setup', description: 'Configure terminal settings', descriptionKey: 'messageInput.terminalSetupDesc', builtIn: true, icon: CommandIcon },
  { label: 'memory', value: '/memory', description: 'Edit project memory file', descriptionKey: 'messageInput.memoryDesc', builtIn: true, icon: Brain },
];

const CHAT_DRAFT_STORAGE_KEY = 'lumos.chat.draft';
const CHAT_DRAFT_EVENT = 'lumos:chat-draft';
const IMAGE_REQUEST_HINT_REGEX = /(生成图片|生成一张图|做图|改图|出图|海报|主图|banner|封面|插画|渲染|画一张|render|draw|generate image|image poster|image banner)/i;

// Pricing helpers (formatYuanPerMtok / QUOTA_UNITS_PER_YUAN) live in
// @/lib/pricing and are imported at the top of the file.

interface ChatDraftPayload {
  text: string;
  mode?: 'replace' | 'append';
}

interface ChatUrlReferencePayload {
  url?: string;
  title?: string;
  pageId?: string;
}

interface UrlReferenceChip {
  id: string;
  url: string;
  title: string;
  pageId?: string;
}

/**
 * Build a structured "[参考网页]" section appended to the outgoing message
 * body. Keeps URLs out of the visible input (chips render above the textarea
 * via UrlReferenceCapsules) while still giving the AI structured context.
 */
function buildUrlReferenceHint(refs: UrlReferenceChip[]): string {
  if (refs.length === 0) return '';
  const lines = ['', '[参考网页]'];
  for (const r of refs) {
    if (r.title && r.title !== r.url) {
      lines.push(`- ${r.title}: ${r.url}`);
    } else {
      lines.push(`- ${r.url}`);
    }
  }
  return lines.join('\n');
}

interface CreationTextRef {
  id: string;
  label: string;
  text: string;
}

// 创作图片引用：素材/详情图/仓库图"加入对话"。chip 显示缩略(previewUrl)，发送时 fetch 转附件。
// 本地图给 path(→/api/media/serve)，直链图给 url。
interface CreationImageRef {
  id: string;
  label: string;
  filePath?: string;
  previewUrl: string;
}

// 创作引用：标题/评论/评论分析等"加入对话"的文字。发送时合并进消息体(AI 能看到)，
// 输入框上方用 chip 预览、用户气泡保持干净(走 displayOverride)。
function buildCreationTextHint(refs: CreationTextRef[]): string {
  if (refs.length === 0) return '';
  const lines = ['', '[引用资料]'];
  for (const r of refs) lines.push(`【${r.label}】${r.text}`);
  return lines.join('\n');
}

function readStorageValue(key: string): string {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem(key)?.trim() || '';
}

function readStoredChatProviderId(): string {
  return readStorageValue(CHAT_DEFAULT_PROVIDER_STORAGE_KEY);
}

function readStoredChatModel(): string {
  return readStorageValue(CHAT_DEFAULT_MODEL_STORAGE_KEY)
    || readStorageValue(LEGACY_CHAT_DEFAULT_MODEL_STORAGE_KEY)
    || readStorageValue(LEGACY_CODEPILOT_MODEL_STORAGE_KEY);
}

function persistStoredChatSelection(providerId: string, model: string): void {
  if (typeof window === 'undefined') return;
  const normalizedProviderId = providerId.trim();
  const normalizedModel = model.trim();
  if (normalizedProviderId) {
    localStorage.setItem(CHAT_DEFAULT_PROVIDER_STORAGE_KEY, normalizedProviderId);
  }
  if (normalizedModel) {
    localStorage.setItem(CHAT_DEFAULT_MODEL_STORAGE_KEY, normalizedModel);
    localStorage.setItem(LEGACY_CHAT_DEFAULT_MODEL_STORAGE_KEY, normalizedModel);
  }
}

function clearStoredChatSelection(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(CHAT_DEFAULT_PROVIDER_STORAGE_KEY);
  localStorage.removeItem(CHAT_DEFAULT_MODEL_STORAGE_KEY);
  localStorage.removeItem(LEGACY_CHAT_DEFAULT_MODEL_STORAGE_KEY);
  localStorage.removeItem(LEGACY_CODEPILOT_MODEL_STORAGE_KEY);
}

/**
 * Convert a data URL to a FileAttachment object.
 */
async function dataUrlToFileAttachment(
  dataUrl: string,
  filename: string,
  mediaType: string,
): Promise<FileAttachment> {
  // data:image/png;base64,<data>  — extract the base64 part
  const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;

  // Estimate raw size from base64 length
  const size = Math.ceil((base64.length * 3) / 4);

  return {
    id: nanoid(),
    name: filename,
    type: mediaType || 'application/octet-stream',
    size,
    data: base64,
  };
}

/**
 * Submit button that's aware of file attachments. Must be rendered inside PromptInput.
 */
function FileAwareSubmitButton({
  status,
  onStop,
  disabled,
  inputValue,
  hasBadge,
}: {
  status: ChatStatus;
  onStop?: () => void;
  disabled?: boolean;
  inputValue: string;
  hasBadge: boolean;
}) {
  const attachments = usePromptInputAttachments();
  const hasFiles = attachments.files.length > 0;
  const isStreaming = status === 'streaming' || status === 'submitted';

  return (
    <PromptInputSubmit
      status={status}
      onStop={onStop}
      disabled={disabled || (!isStreaming && !inputValue.trim() && !hasBadge && !hasFiles)}
      className="rounded-full"
    >
      {isStreaming ? (
        <HugeiconsIcon icon={Stop} className="size-4" />
      ) : (
        <HugeiconsIcon icon={ArrowUp} className="h-4 w-4" strokeWidth={2} />
      )}
    </PromptInputSubmit>
  );
}

/**
 * Attachment button that opens the file dialog. Must be rendered inside PromptInput.
 */
function AttachFileButton() {
  const attachments = usePromptInputAttachments();
  const { t } = useTranslation();

  return (
    <PromptInputButton
      onClick={() => attachments.openFileDialog()}
      tooltip={t('messageInput.attachFiles')}
    >
      <HugeiconsIcon icon={Add} className="h-3.5 w-3.5" />
    </PromptInputButton>
  );
}

/**
 * Infer a MIME type from a filename extension so that files added from the
 * file tree pass the PromptInput accept-type validation.  Code / text files
 * are mapped to `text/*` subtypes; images and PDFs get their standard types.
 * Falls back to `application/octet-stream` for unknown extensions.
 */
function mimeFromFilename(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  const TEXT_EXTS: Record<string, string> = {
    md: 'text/markdown', mdx: 'text/markdown',
    txt: 'text/plain', csv: 'text/csv',
    json: 'application/json',
    ts: 'text/typescript', tsx: 'text/typescript',
    js: 'text/javascript', jsx: 'text/javascript',
    py: 'text/x-python', go: 'text/x-go', rs: 'text/x-rust',
    rb: 'text/x-ruby', java: 'text/x-java', c: 'text/x-c',
    cpp: 'text/x-c++', h: 'text/x-c', hpp: 'text/x-c++',
    cs: 'text/x-csharp', swift: 'text/x-swift', kt: 'text/x-kotlin',
    html: 'text/html', css: 'text/css', scss: 'text/css',
    xml: 'text/xml', yaml: 'text/yaml', yml: 'text/yaml',
    toml: 'text/plain', ini: 'text/plain', cfg: 'text/plain',
    sh: 'text/x-shellscript', bash: 'text/x-shellscript', zsh: 'text/x-shellscript',
    sql: 'text/x-sql', graphql: 'text/plain', gql: 'text/plain',
    vue: 'text/plain', svelte: 'text/plain', astro: 'text/plain',
    env: 'text/plain', gitignore: 'text/plain', dockerignore: 'text/plain',
    dockerfile: 'text/plain', makefile: 'text/plain',
    log: 'text/plain', lock: 'text/plain',
  };
  const IMAGE_EXTS: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
    gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
  };
  const audioMime = inferAudioMimeFromFilename(name, '');
  if (TEXT_EXTS[ext]) return TEXT_EXTS[ext];
  if (IMAGE_EXTS[ext]) return IMAGE_EXTS[ext];
  if (audioMime) return audioMime;
  if (ext === 'pdf') return 'application/pdf';
  // Default to text/plain so unknown extensions still pass text/* validation
  return 'text/plain';
}

/**
 * Bridge component that listens for 'attach-file-to-chat' custom events
 * from the file tree and adds files as attachments. Must be rendered inside PromptInput.
 */
function FileTreeAttachmentBridge() {
  const attachments = usePromptInputAttachments();
  const attachmentsRef = useRef(attachments);

  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  useEffect(() => {
    const handler = async (e: Event) => {
      const customEvent = e as CustomEvent<{ path: string }>;
      const filePath = customEvent.detail?.path;
      if (!filePath) return;

      try {
        const filename = filePath.split(/[/\\]/).pop() || 'file';
        const mime = mimeFromFilename(filename);
        console.log('[FileTreeAttachment] Adding file reference:', filename, 'path:', filePath);
        attachmentsRef.current.addReference(filePath, filename, mime);
      } catch (err) {
        console.error('[FileTreeAttachment] Error attaching file:', filePath, err);
      }
    };

    window.addEventListener('attach-file-to-chat', handler);
    return () => window.removeEventListener('attach-file-to-chat', handler);
  }, []);

  return null;
}

/**
 * Capsule display for attached files, rendered inside PromptInput context.
 */
function FileAttachmentsCapsules() {
  const attachments = usePromptInputAttachments();

  if (attachments.files.length === 0) return null;

  return (
    <div className="flex w-full flex-wrap items-center gap-1.5 px-3 pt-2 pb-0 order-first">
      {attachments.files.map((file) => {
        const isImage = file.mediaType?.startsWith('image/');
        return (
          <span
            key={file.id}
            className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 pl-2 pr-1 py-0.5 text-xs font-medium border border-emerald-500/20"
          >
            {isImage && file.url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={file.url}
                alt={file.filename || 'image'}
                className="h-5 w-5 rounded object-cover"
              />
            )}
            <span className="max-w-[120px] truncate text-[11px]">
              {file.filename || 'file'}
            </span>
            <button
              type="button"
              onClick={() => attachments.remove(file.id)}
              className="ml-0.5 rounded-full p-0.5 hover:bg-emerald-500/20 transition-colors"
            >
              <HugeiconsIcon icon={Cancel} className="h-3 w-3" />
            </button>
          </span>
        );
      })}
    </div>
  );
}

export function MessageInput({
  onSend,
  onCommand,
  onStop,
  disabled,
  isStreaming,
  sessionId,
  modelName,
  resolvedModelName,
  onModelChange,
  providerId,
  onProviderModelChange,
  workingDirectory,
  initialKnowledgeEnabled = false,
  initialKnowledgeOptions,
  onKnowledgeOptionsChange,
  onInputFocus,
  fullWidth = false,
  providerModelsEndpoint = '/api/providers/models',
  teamId,
  teamName,
  onTeamChange,
}: MessageInputProps) {
  const { t } = useTranslation();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const modelMenuRef = useRef<HTMLDivElement>(null);
  const knowledgeMenuRef = useRef<HTMLDivElement>(null);
  const teamMenuRef = useRef<HTMLDivElement>(null);

  const [popoverMode, setPopoverMode] = useState<PopoverMode>(null);
  const [popoverItems, setPopoverItems] = useState<PopoverItem[]>([]);
  const [popoverFilter, setPopoverFilter] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [triggerPos, setTriggerPos] = useState<number | null>(null);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [teamMenuOpen, setTeamMenuOpen] = useState(false);
  const [teamOptions, setTeamOptions] = useState<Array<{ id: string; name: string; memberCount: number }>>([]);
  const [inputValue, setInputValue] = useState('');
  const [badge, setBadge] = useState<CommandBadge | null>(null);
  // URL reference chips. The browser-panel "+" button (or any other source
  // dispatching `attach-url-to-chat`) appends here as a chip rather than
  // pasting raw text into the input. Chips render above the textarea, can be
  // removed by user, and are appended as a structured "[参考网页]" section in
  // the outgoing message body so the AI sees them but the input stays clean.
  const [urlReferences, setUrlReferences] = useState<UrlReferenceChip[]>([]);
  const [creationTextRefs, setCreationTextRefs] = useState<CreationTextRef[]>([]);
  const [creationImageRefs, setCreationImageRefs] = useState<CreationImageRef[]>([]);
  const [providerGroups, setProviderGroups] = useState<ProviderModelGroup[]>([]);
  const [defaultProviderId, setDefaultProviderId] = useState<string>('');
  const [defaultModel, setDefaultModel] = useState<string>('');
  const [storedProviderId, setStoredProviderId] = useState(readStoredChatProviderId);
  const [storedModel, setStoredModel] = useState(readStoredChatModel);
  const [aiSuggestions, setAiSuggestions] = useState<PopoverItem[]>([]);
  const [aiSearchLoading, setAiSearchLoading] = useState(false);
  const [knowledgeEnabled, setKnowledgeEnabled] = useState(initialKnowledgeOptions?.enabled ?? initialKnowledgeEnabled);
  const [knowledgeMenuOpen, setKnowledgeMenuOpen] = useState(false);
  const [selectedKnowledgeTagIds, setSelectedKnowledgeTagIds] = useState<string[]>(initialKnowledgeOptions?.tagIds ?? []);
  const [knowledgeOverrides, setKnowledgeOverrides] = useState<KnowledgeOverrides>(initialKnowledgeOptions?.overrides ?? {});
  const [imageProviderConfig, setImageProviderConfig] = useState<ImageProviderUiConfigResponse | null>(null);
  const [imageOptionsOpen, setImageOptionsOpen] = useState(false);
  const [imageAspectRatio, setImageAspectRatio] = useState('1:1');
  const [imageResolution, setImageResolution] = useState('1K');
  const [imageCount, setImageCount] = useState(1);
  const [imageAdvancedOpen, setImageAdvancedOpen] = useState(false);
  const [imageAdvancedValues, setImageAdvancedValues] = useState<Record<string, unknown>>({});
  const [imageOptionsError, setImageOptionsError] = useState<string | null>(null);
  const aiSearchAbortRef = useRef<AbortController | null>(null);
  const aiSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastAutoImagePanelPromptRef = useRef('');

  useEffect(() => {
    setKnowledgeEnabled(initialKnowledgeOptions?.enabled ?? initialKnowledgeEnabled);
    setSelectedKnowledgeTagIds(initialKnowledgeOptions?.tagIds ?? []);
    setKnowledgeOverrides(initialKnowledgeOptions?.overrides ?? {});
  }, [initialKnowledgeEnabled, initialKnowledgeOptions]);

  // Fetch provider groups from API
  const fetchProviderModels = useCallback(() => {
    fetch(providerModelsEndpoint)
      .then((r) => r.json())
      .then((data) => {
        const providerModels = data.providerModels || data;
        setProviderGroups(providerModels.groups || []);
        setDefaultProviderId(providerModels.default_provider_id || '');
        setDefaultModel(providerModels.default_model || '');
      })
      .catch(() => {
        setProviderGroups([]);
        setDefaultProviderId('');
        setDefaultModel('');
      });
  }, [providerModelsEndpoint]);

  // Load models on mount and listen for provider changes
  useEffect(() => {
    fetchProviderModels();
    const handler = () => fetchProviderModels();
    window.addEventListener('provider-changed', handler);
    return () => window.removeEventListener('provider-changed', handler);
  }, [fetchProviderModels]);

  // 外部"加入对话"：标题/评论/评论分析作为引用 chip(上方预览 + 可删)，发送时合并进消息体、不糊输入框。
  useEffect(() => {
    const handler = (e: Event) => {
      const d = (e as CustomEvent<{ text?: string; label?: string }>).detail;
      const text = d?.text?.trim();
      if (!text) return;
      setCreationTextRefs((cur) => [...cur, { id: nanoid(), label: d?.label?.trim() || '引用', text }]);
      setTimeout(() => textareaRef.current?.focus(), 0);
    };
    window.addEventListener('insert-text-to-chat', handler);
    return () => window.removeEventListener('insert-text-to-chat', handler);
  }, []);

  // 外部"加入对话"(图)：素材/详情图作为带缩略的引用 chip，发送时读本地文件转附件。
  useEffect(() => {
    const handler = (e: Event) => {
      const d = (e as CustomEvent<{ path?: string; url?: string; label?: string }>).detail;
      const filePath = d?.path?.trim();
      const previewUrl = d?.url?.trim() || (filePath ? `/api/media/serve?path=${encodeURIComponent(filePath)}` : '');
      if (!previewUrl) return;
      setCreationImageRefs((cur) => {
        if (cur.some((r) => r.previewUrl === previewUrl)) return cur;
        return [...cur, { id: nanoid(), label: d?.label?.trim() || '图片', filePath, previewUrl }];
      });
    };
    window.addEventListener('attach-image-ref-to-chat', handler);
    return () => window.removeEventListener('attach-image-ref-to-chat', handler);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadImageProviderConfig = async () => {
      try {
        const response = await fetch('/api/media/provider-config', { cache: 'no-store' });
        if (!response.ok) {
          if (!cancelled) setImageProviderConfig(null);
          return;
        }

        const data = await response.json() as ImageProviderUiConfigResponse;
        if (cancelled) return;

        setImageProviderConfig(data);
        setImageAspectRatio(data.defaults?.aspectRatio || '1:1');
        setImageResolution(data.defaults?.resolution || '1K');
        setImageCount(data.defaults?.count || 1);
        setImageAdvancedValues(buildDefaultAdvancedValues(
          data.uiConfig.advancedOptions ?? {},
          data.defaults?.providerOptions,
        ));
      } catch {
        if (!cancelled) setImageProviderConfig(null);
      }
    };

    loadImageProviderConfig();
    const handleProviderChange = () => { void loadImageProviderConfig(); };
    window.addEventListener('provider-changed', handleProviderChange);
    return () => {
      cancelled = true;
      window.removeEventListener('provider-changed', handleProviderChange);
    };
  }, []);

  useEffect(() => {
    if (!imageProviderConfig || imageOptionsOpen) return;
    const trimmed = inputValue.trim();
    if (!trimmed) {
      lastAutoImagePanelPromptRef.current = '';
      return;
    }
    if (
      IMAGE_REQUEST_HINT_REGEX.test(trimmed)
      && trimmed !== lastAutoImagePanelPromptRef.current
    ) {
      lastAutoImagePanelPromptRef.current = trimmed;
      setImageOptionsOpen(true);
    }
  }, [imageOptionsOpen, imageProviderConfig, inputValue]);

  // When admin disallows the chat custom-provider category in pro edition,
  // hide custom providers everywhere chat UI consults the model list — the
  // dropdown, the "current provider" resolution, and default fallback all
  // need to agree, otherwise a stale selection can keep a hidden custom
  // provider active. Mirrors the ChatProvidersCard readOnly filter.
  // selector 直接返回 boolean,余额 / nickname 等其它字段变化时 selector 结果
  // 不变,组件不会被无意义重渲染 —— 这是修 input 失焦的关键。
  const chatReadOnly = useProAuthSelector(
    (s) => isPro() && s.user?.allow_custom_providers?.chat === false,
  );
  const visibleProviderGroups = useMemo(
    () => filterVisibleChatProviderGroups(providerGroups, chatReadOnly),
    [providerGroups, chatReadOnly],
  );
  const selectableProviderGroups = useMemo(
    () => visibleProviderGroups.map((group) => (
      group.models.length > 0 ? group : { ...group, models: DEFAULT_PROVIDER_MODEL_OPTIONS }
    )),
    [visibleProviderGroups],
  );

  useEffect(() => {
    if (!chatReadOnly || !storedProviderId) return;
    if (selectableProviderGroups.some((group) => group.provider_id === storedProviderId)) return;
    clearStoredChatSelection();
    setStoredProviderId('');
    setStoredModel('');
  }, [chatReadOnly, selectableProviderGroups, storedProviderId]);

  // Derive active provider + model for the selector.
  const selection = useMemo(
    () => resolveChatProviderModelSelection({
      groups: selectableProviderGroups,
      sessionProviderId: providerId,
      currentModel: modelName,
      storedProviderId,
      storedModel,
      defaultProviderId,
      backendDefaultModel: defaultModel,
    }),
    [defaultModel, defaultProviderId, modelName, providerId, selectableProviderGroups, storedModel, storedProviderId],
  );
  const hasExplicitProvider = selection.sessionProviderAvailable;
  const currentProviderIdValue = selection.providerId;
  const currentModelValue = selection.model;
  const hasProviders = selectableProviderGroups.length > 0;
  const currentGroup = selection.provider || selectableProviderGroups[0];
  const MODEL_OPTIONS = useMemo(
    () => currentGroup?.models || [],
    [currentGroup],
  );
  const imageSupportedAspectRatios = useMemo<string[]>(
    () => imageProviderConfig?.uiConfig.supportedAspectRatios ?? ['1:1'],
    [imageProviderConfig],
  );
  const imageSupportedResolutions = useMemo<string[]>(
    () => imageProviderConfig?.uiConfig.supportedResolutions ?? ['1K'],
    [imageProviderConfig],
  );
  const imageMaxCount = imageProviderConfig?.uiConfig.maxCount ?? 4;

  useEffect(() => {
    if (!imageSupportedAspectRatios.includes(imageAspectRatio)) {
      setImageAspectRatio(imageSupportedAspectRatios[0] || '1:1');
    }
  }, [imageAspectRatio, imageSupportedAspectRatios]);

  useEffect(() => {
    if (!imageSupportedResolutions.includes(imageResolution)) {
      setImageResolution(imageSupportedResolutions[0] || '1K');
    }
  }, [imageResolution, imageSupportedResolutions]);

  useEffect(() => {
    if (imageCount > imageMaxCount) {
      setImageCount(imageMaxCount);
    }
  }, [imageCount, imageMaxCount]);

  useEffect(() => {
    if (MODEL_OPTIONS.length === 0 || !currentProviderIdValue || !currentModelValue) return;

    const nextProviderId = currentProviderIdValue;
    const currentValue = modelName?.trim() || '';
    const providerMissing = !providerId || !hasExplicitProvider;
    const modelChanged = currentValue !== currentModelValue;

    if ((providerMissing || modelChanged) && onProviderModelChange) {
      onProviderModelChange(nextProviderId, currentModelValue);
      return;
    }

    if (modelChanged) {
      onModelChange?.(currentModelValue);
    }
  }, [
    MODEL_OPTIONS,
    currentModelValue,
    currentProviderIdValue,
    hasExplicitProvider,
    modelName,
    onModelChange,
    onProviderModelChange,
    providerId,
  ]);

  // Fetch files for @ mention
  const fetchFiles = useCallback(async (filter: string) => {
    if (!workingDirectory) return [];
    try {
      const params = new URLSearchParams();
      params.set('dir', workingDirectory);
      if (sessionId) params.set('session_id', sessionId);
      if (filter) params.set('q', filter);
      const res = await fetch(`/api/files?${params.toString()}`);
      if (!res.ok) return [];
      const data = await res.json();
      const tree = data.tree || [];
      const items: PopoverItem[] = [];
      function flattenTree(nodes: Array<{ name: string; path: string; type: string; children?: unknown[] }>) {
        for (const node of nodes) {
          items.push({ label: node.name, value: node.path });
          if (node.children) flattenTree(node.children as typeof nodes);
        }
      }
      flattenTree(tree);
      return items.slice(0, 20);
    } catch {
      return [];
    }
  }, [sessionId, workingDirectory]);

  // Fetch skills for / command (built-in + API)
  // Returns all items unfiltered — filtering is done by filteredItems
  const fetchSkills = useCallback(async () => {
    let apiSkills: PopoverItem[] = [];
    try {
      const cwdParam = workingDirectory ? `?cwd=${encodeURIComponent(workingDirectory)}` : '';
      const res = await fetch(`/api/skills${cwdParam}`);
      if (res.ok) {
        const data = await res.json();
        const skills = data.skills || [];
        apiSkills = skills
          .map((s: { name: string; description: string; source?: "global" | "project" | "plugin" | "installed"; installedSource?: "agents" | "claude" }) => ({
            label: s.name,
            value: `/${s.name}`,
            description: s.description || "",
            builtIn: false,
            installedSource: s.installedSource,
            source: s.source,
          }));
      }
    } catch {
      // API not available - just use built-in commands
    }

    // Deduplicate: remove API skills that share a name with built-in commands
    const builtInNames = new Set(BUILT_IN_COMMANDS.map(c => c.label));
    const uniqueSkills = apiSkills.filter(s => !builtInNames.has(s.label));

    return [...BUILT_IN_COMMANDS, ...uniqueSkills];
  }, [workingDirectory]);

  // Close popover
  const closePopover = useCallback(() => {
    setPopoverMode(null);
    setPopoverItems([]);
    setPopoverFilter('');
    setSelectedIndex(0);
    setTriggerPos(null);
    // Clean up AI search state
    setAiSuggestions([]);
    setAiSearchLoading(false);
    if (aiSearchTimerRef.current) {
      clearTimeout(aiSearchTimerRef.current);
      aiSearchTimerRef.current = null;
    }
    if (aiSearchAbortRef.current) {
      aiSearchAbortRef.current.abort();
      aiSearchAbortRef.current = null;
    }
  }, []);

  // Remove active badge
  const removeBadge = useCallback(() => {
    setBadge(null);
    setTimeout(() => textareaRef.current?.focus(), 0);
  }, []);

  useEffect(() => {
    const applyDraft = (payload: ChatDraftPayload) => {
      if (!payload.text.trim()) {
        return;
      }

      setBadge(null);
      closePopover();
      setInputValue((current) => {
        if (payload.mode === 'append' && current.trim()) {
          return `${current}\n\n${payload.text}`;
        }
        return payload.text;
      });
      setTimeout(() => textareaRef.current?.focus(), 0);
    };

    const consumeStoredDraft = () => {
      const raw = sessionStorage.getItem(CHAT_DRAFT_STORAGE_KEY);
      if (!raw) {
        return;
      }

      sessionStorage.removeItem(CHAT_DRAFT_STORAGE_KEY);
      try {
        const parsed = JSON.parse(raw) as ChatDraftPayload;
        if (typeof parsed?.text === 'string') {
          applyDraft(parsed);
        }
      } catch {
        // Ignore malformed draft payloads.
      }
    };

    consumeStoredDraft();

    const handleDraft = (event: Event) => {
      const payload = (event as CustomEvent<ChatDraftPayload>).detail;
      if (!payload || typeof payload.text !== 'string') {
        return;
      }
      sessionStorage.removeItem(CHAT_DRAFT_STORAGE_KEY);
      applyDraft(payload);
    };

    window.addEventListener(CHAT_DRAFT_EVENT, handleDraft);
    return () => window.removeEventListener(CHAT_DRAFT_EVENT, handleDraft);
  }, [closePopover]);

  useEffect(() => {
    const handler = (event: Event) => {
      const payload = (event as CustomEvent<ChatUrlReferencePayload>).detail;
      const url = typeof payload?.url === 'string' ? payload.url.trim() : '';
      if (!url) return;

      const title = typeof payload?.title === 'string' ? payload.title.trim() : '';
      const pageId = typeof payload?.pageId === 'string' ? payload.pageId : undefined;

      setBadge(null);
      closePopover();
      // Append as a removable chip instead of polluting the input text. The
      // chip renders above the textarea (UrlReferenceCapsules); the URL is
      // attached to the outgoing message via buildUrlHint() at send time.
      setUrlReferences((current) => {
        if (current.some((r) => r.url === url)) return current;
        return [...current, { id: nanoid(), url, title: title || url, pageId }];
      });
      setTimeout(() => textareaRef.current?.focus(), 0);
    };

    window.addEventListener('attach-url-to-chat', handler);
    return () => window.removeEventListener('attach-url-to-chat', handler);
  }, [closePopover]);

  // Insert selected item
  const insertItem = useCallback((item: PopoverItem) => {
    if (triggerPos === null) return;

    // Immediate built-in commands: execute right away
    if (item.builtIn && item.immediate && onCommand) {
      setInputValue('');
      closePopover();
      onCommand(item.value);
      return;
    }

    // Non-immediate commands (prompt-based built-ins and skills): show as badge
    if (popoverMode === 'skill') {
      setBadge({
        command: item.value,
        label: item.label,
        description: item.description || '',
        isSkill: !item.builtIn,
        installedSource: item.installedSource,
      });
      setInputValue('');
      closePopover();
      setTimeout(() => textareaRef.current?.focus(), 0);
      return;
    }

    // File mention: insert into text
    const currentVal = inputValue;
    const before = currentVal.slice(0, triggerPos);
    const cursorEnd = triggerPos + popoverFilter.length + 1;
    const after = currentVal.slice(cursorEnd);
    const insertText = `@${item.value} `;

    setInputValue(before + insertText + after);
    closePopover();

    // Refocus textarea
    setTimeout(() => textareaRef.current?.focus(), 0);
  }, [triggerPos, popoverMode, closePopover, onCommand, inputValue, popoverFilter]);

  // Handle input changes to detect @ and /
  const handleInputChange = useCallback(async (val: string) => {
    setInputValue(val);

    const textarea = textareaRef.current;
    if (!textarea) return;

    const cursorPos = textarea.selectionStart;
    const beforeCursor = val.slice(0, cursorPos);

    // Check for @ trigger
    const atMatch = beforeCursor.match(/@([^\s@]*)$/);
    if (atMatch) {
      const filter = atMatch[1];
      setPopoverMode('file');
      setPopoverFilter(filter);
      setTriggerPos(cursorPos - atMatch[0].length);
      setSelectedIndex(0);
      const items = await fetchFiles(filter);
      setPopoverItems(items);
      return;
    }

    // Check for / trigger (only at start of line or after space)
    const slashMatch = beforeCursor.match(/(^|\s)\/([^\s]*)$/);
    if (slashMatch) {
      const filter = slashMatch[2];
      setPopoverMode('skill');
      setPopoverFilter(filter);
      setTriggerPos(cursorPos - slashMatch[2].length - 1);
      setSelectedIndex(0);
      const items = await fetchSkills();
      setPopoverItems(items);
      return;
    }

    if (popoverMode) {
      closePopover();
    }
  }, [fetchFiles, fetchSkills, popoverMode, closePopover]);

  const buildImageOverridePrompt = useCallback(() => {
    if (!imageOptionsOpen || !imageProviderConfig) return undefined;

    const providerOptions: Record<string, unknown> = {};
    const advancedSchema = imageProviderConfig.uiConfig.advancedOptions ?? {};

    for (const [key, value] of Object.entries(imageAdvancedValues)) {
      const def = advancedSchema[key];
      if (!def) continue;

      if (def.type === 'json') {
        if (typeof value !== 'string' || !value.trim()) continue;
        try {
          providerOptions[key] = JSON.parse(value);
        } catch {
          throw new Error(`高级参数“${def.label}”不是合法 JSON`);
        }
        continue;
      }

      if (def.type === 'number') {
        if (value === '' || value === null || value === undefined) continue;
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) {
          throw new Error(`高级参数“${def.label}”不是合法数字`);
        }
        providerOptions[key] = parsed;
        continue;
      }

      if (def.type === 'boolean') {
        if (typeof value === 'boolean') providerOptions[key] = value;
        continue;
      }

      if (typeof value === 'string' && value.trim()) {
        providerOptions[key] = value.trim();
      }
    }

    return buildImageGenerationSystemPrompt({
      aspectRatio: imageAspectRatio,
      resolution: imageResolution,
      count: imageCount,
      providerOptions,
    }) || undefined;
  }, [
    imageAdvancedValues,
    imageAspectRatio,
    imageCount,
    imageOptionsOpen,
    imageProviderConfig,
    imageResolution,
  ]);

  const handleSubmit = useCallback(async (msg: { text: string; files: PromptFileItem[] }, e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const content = inputValue.trim();

    closePopover();

    const getReferencedFileSize = async (filePath: string): Promise<number> => {
      const head = await fetch(`/api/files/raw?path=${encodeURIComponent(filePath)}`, { method: 'HEAD' });
      if (!head.ok) return 0;
      const sizeHeader = head.headers.get('content-length');
      const size = sizeHeader ? Number.parseInt(sizeHeader, 10) : 0;
      return Number.isFinite(size) ? size : 0;
    };

    const convertFiles = async (): Promise<FileAttachment[]> => {
      if (!msg.files || msg.files.length === 0) return [];

      const attachments: FileAttachment[] = [];
      for (const file of msg.files) {
        const filename = file.filename || 'file';
        const mediaType = file.mediaType || inferAudioMimeFromFilename(filename);
        const isAudio = isAudioFileLike({ filename, mediaType });

        if (isAudio && file.filePath) {
          try {
            const size = typeof file.size === 'number' && file.size > 0
              ? file.size
              : await getReferencedFileSize(file.filePath);
            attachments.push({
              id: file.id || nanoid(),
              name: filename,
              type: mediaType,
              size,
              data: '',
              filePath: file.filePath,
            });
          } catch (err) {
            console.warn('[convertFiles] audio path probe failed:', file.filePath, err);
          }
          continue;
        }

        // Check if this is a file path reference (has filePath but no url)
        if ('filePath' in file && file.filePath && !file.url) {
          try {
            // Read file content from disk at send time
            const res = await fetch(`/api/files/raw?path=${encodeURIComponent(file.filePath)}`);
            if (!res.ok) {
              console.warn(`[convertFiles] Failed to read ${file.filePath}`);
              continue;
            }
            const blob = await res.blob();
            const reader = new FileReader();
            const base64 = await new Promise<string>((resolve, reject) => {
              reader.onloadend = () => {
                const dataUrl = reader.result as string;
                const base64Data = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
                resolve(base64Data);
              };
              reader.onerror = reject;
              reader.readAsDataURL(blob);
            });

            const attachment: FileAttachment = {
              id: file.id || nanoid(),
              name: filename,
              type: mediaType,
              size: blob.size,
              data: base64,
              filePath: file.filePath,
            };

            // Enforce per-type size limits
            const isImage = attachment.type.startsWith('image/');
            const sizeLimit = isImage ? MAX_IMAGE_SIZE : MAX_DOC_SIZE;
            if (attachment.size <= sizeLimit) {
              attachments.push(attachment);
            }
          } catch (err) {
            console.error('[convertFiles] Error reading file reference:', file.filePath, err);
          }
        } else if (file.url) {
          if (!file.url.startsWith('data:')) {
            console.warn(`[convertFiles] file URL was not converted to data URL, skipping ${filename}`);
            continue;
          }
          try {
            const attachment = await dataUrlToFileAttachment(
              file.url,
              filename,
              mediaType,
            );
            // Enforce per-type size limits
            const isImage = attachment.type.startsWith('image/');
            const sizeLimit = isImage ? MAX_IMAGE_SIZE : isAudio ? Number.POSITIVE_INFINITY : MAX_DOC_SIZE;
            if (attachment.size <= sizeLimit) {
              attachments.push(attachment);
            }
          } catch {
            // Skip files that fail conversion
          }
        }
	      }
	      return attachments;
	    };

    // 创作图片引用 → 附件：发送时读本地文件(media/serve)转 base64，并进 onSend 的 files。
    const convertCreationImageRefs = async (): Promise<FileAttachment[]> => {
      const out: FileAttachment[] = [];
      for (const ref of creationImageRefs) {
        try {
          const res = await fetch(ref.previewUrl);
          if (!res.ok) continue;
          const blob = await res.blob();
          const base64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
              const dataUrl = reader.result as string;
              resolve(dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl);
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
          out.push({
            id: nanoid(),
            name: ref.label || 'image.png',
            type: blob.type || 'image/png',
            size: blob.size,
            data: base64,
            filePath: ref.filePath,
          });
        } catch {
          /* 跳过读不出的图 */
        }
      }
      return out;
    };

    // If Image Agent toggle is on and no badge, send via normal LLM with systemPromptAppend
    // If badge is active, expand the command/skill and send
    if (badge && !isStreaming) {
      let expandedPrompt = '';

      if (badge.isSkill) {
        // Fetch skill content from API
        try {
          const detailParams = new URLSearchParams();
          if (badge.installedSource) detailParams.set("source", badge.installedSource);
          if (workingDirectory) detailParams.set("cwd", workingDirectory);
          const qs = detailParams.toString();
          const res = await fetch(
            `/api/skills/${encodeURIComponent(badge.label)}${qs ? `?${qs}` : ""}`
          );
          if (res.ok) {
            const data = await res.json();
            expandedPrompt = data.skill?.content || '';
          }
        } catch {
          // Fallback: use command name
        }
      } else {
        // Built-in prompt command expansion
        expandedPrompt = COMMAND_PROMPTS[badge.command] || '';
      }

      const finalPrompt = content
        ? `${expandedPrompt}\n\nUser context: ${content}`
        : expandedPrompt || badge.command;

      const files = [...(await convertFiles()), ...(await convertCreationImageRefs())];
      const knowledgeOptions: ChatKnowledgeOptions = {
        enabled: knowledgeEnabled,
        tagIds: selectedKnowledgeTagIds,
        ...(Object.keys(knowledgeOverrides).length > 0 ? { overrides: knowledgeOverrides } : {}),
      };
      let imageOverridePrompt: string | undefined;
      try {
        imageOverridePrompt = buildImageOverridePrompt();
        setImageOptionsError(null);
      } catch (error) {
        setImageOptionsError(error instanceof Error ? error.message : '图片高级参数格式错误');
        return;
      }
      const urlHint = buildUrlReferenceHint(urlReferences);
      const textHint = buildCreationTextHint(creationTextRefs);
      const refsHint = `${urlHint}${textHint}`;
      const finalPromptWithRefs = refsHint ? `${finalPrompt}${refsHint}` : finalPrompt;
      setBadge(null);
      setInputValue('');
      setUrlReferences([]);
      setCreationTextRefs([]);
      setCreationImageRefs([]);
      // displayOverride keeps the user bubble clean of the hint —
      // AI gets the full text via `content`, but user only sees their input.
      onSend(
        finalPromptWithRefs,
        files.length > 0 ? files : undefined,
        imageOverridePrompt,
        refsHint ? finalPrompt : undefined,
        knowledgeOptions,
      );
      return;
    }

    const files = [...(await convertFiles()), ...(await convertCreationImageRefs())];
    const hasFiles = files.length > 0;

    const hasContent = content.length > 0;
    const hasUrlRefsForGuard = urlReferences.length > 0 || creationTextRefs.length > 0;
    if ((!hasContent && !hasFiles && !hasUrlRefsForGuard) || disabled || isStreaming || !hasProviders) return;

    // Check if it's a direct slash command typed in the input
    if (content.startsWith('/') && !hasFiles) {
      const cmd = BUILT_IN_COMMANDS.find(c => c.value === content);
      if (cmd) {
        if (cmd.immediate && onCommand) {
          setInputValue('');
          onCommand(content);
          return;
        }
        // Non-immediate: show as badge for user to add context
        setBadge({
          command: cmd.value,
          label: cmd.label,
          description: cmd.description || '',
          isSkill: false,
        });
        setInputValue('');
        return;
      }

      // Not a built-in command — treat as a skill
      const skillName = content.slice(1);
      if (skillName) {
        setBadge({
          command: content,
          label: skillName,
          description: '',
          isSkill: true,
        });
        setInputValue('');
        return;
      }
    }

    let imageOverridePrompt: string | undefined;
    try {
      imageOverridePrompt = buildImageOverridePrompt();
      setImageOptionsError(null);
    } catch (error) {
      setImageOptionsError(error instanceof Error ? error.message : '图片高级参数格式错误');
      return;
    }

    const hasAudioFiles = files.some((file) => isAudioFileLike({ name: file.name, type: file.type }));
    const hasUrlRefs = urlReferences.length > 0;
    const hasTextRefs = creationTextRefs.length > 0;
    const fallback = hasAudioFiles
      ? '帮我转写并总结下面的音频。'
      : hasUrlRefs
        ? '帮我看看下面的网页。'
        : hasTextRefs
          ? '帮我参考下面的资料创作。'
          : 'Please review the attached file(s).';
    const baseContent = content || fallback;
    const urlHint = buildUrlReferenceHint(urlReferences);
    const textHint = buildCreationTextHint(creationTextRefs);
    const refsHint = `${urlHint}${textHint}`;
    const finalContent = refsHint ? `${baseContent}${refsHint}` : baseContent;

    onSend(
      finalContent,
      files.length > 0 ? files : undefined,
      imageOverridePrompt,
      // displayOverride keeps the user bubble clean of the hint —
      // AI gets the full text via `content`, but user only sees what they typed.
      refsHint ? baseContent : undefined,
      {
        enabled: knowledgeEnabled,
        tagIds: selectedKnowledgeTagIds,
        ...(Object.keys(knowledgeOverrides).length > 0 ? { overrides: knowledgeOverrides } : {}),
      },
    );
    setInputValue('');
    setUrlReferences([]);
    setCreationTextRefs([]);
    setCreationImageRefs([]);
  }, [
    badge,
    buildImageOverridePrompt,
    closePopover,
    disabled,
    hasProviders,
    inputValue,
    isStreaming,
    knowledgeEnabled,
    knowledgeOverrides,
    onCommand,
    onSend,
    selectedKnowledgeTagIds,
    urlReferences,
    creationTextRefs,
    creationImageRefs,
    workingDirectory,
  ]);

  const filteredItems = popoverItems.filter((item) => {
    const q = popoverFilter.toLowerCase();
    return item.label.toLowerCase().includes(q)
      || (item.description || '').toLowerCase().includes(q);
  });

  // Debounced AI semantic search when substring results are insufficient
  const nonBuiltInFilteredCount = filteredItems.filter(i => !i.builtIn).length;
  useEffect(() => {
    // Only trigger for skill mode with enough input and few substring matches
    if (popoverMode !== 'skill' || popoverFilter.length < 2 || nonBuiltInFilteredCount >= 2) {
      setAiSuggestions([]);
      setAiSearchLoading(false);
      if (aiSearchTimerRef.current) {
        clearTimeout(aiSearchTimerRef.current);
        aiSearchTimerRef.current = null;
      }
      if (aiSearchAbortRef.current) {
        aiSearchAbortRef.current.abort();
        aiSearchAbortRef.current = null;
      }
      return;
    }

    // Cancel previous timer and request
    if (aiSearchTimerRef.current) {
      clearTimeout(aiSearchTimerRef.current);
    }
    if (aiSearchAbortRef.current) {
      aiSearchAbortRef.current.abort();
    }

    setAiSearchLoading(true);

    aiSearchTimerRef.current = setTimeout(async () => {
      const abortController = new AbortController();
      aiSearchAbortRef.current = abortController;

      try {
        // Collect non-built-in skills for AI search
        const skillsPayload = popoverItems
          .filter(i => !i.builtIn)
          .map(i => ({ name: i.label, description: (i.description || '').slice(0, 100) }));

        if (skillsPayload.length === 0) {
          setAiSearchLoading(false);
          return;
        }

        const res = await fetch('/api/skills/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: abortController.signal,
          body: JSON.stringify({
            query: popoverFilter,
            skills: skillsPayload,
            model: modelName || 'haiku',
          }),
        });

        if (abortController.signal.aborted) return;

        if (!res.ok) {
          setAiSuggestions([]);
          setAiSearchLoading(false);
          return;
        }

        const data = await res.json();
        const suggestions: string[] = data.suggestions || [];

        // Map suggested names back to PopoverItems, deduplicating against substring results
        const filteredNames = new Set(filteredItems.map(i => i.label));
        const aiItems = suggestions
          .filter(name => !filteredNames.has(name))
          .map(name => popoverItems.find(i => i.label === name))
          .filter((item): item is PopoverItem => !!item);

        setAiSuggestions(aiItems);
      } catch {
        // Silently fail — don't show AI suggestions on error
        if (!abortController.signal.aborted) {
          setAiSuggestions([]);
        }
      } finally {
        if (!abortController.signal.aborted) {
          setAiSearchLoading(false);
        }
      }
    }, 500);

    return () => {
      if (aiSearchTimerRef.current) {
        clearTimeout(aiSearchTimerRef.current);
        aiSearchTimerRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [popoverFilter, popoverMode, nonBuiltInFilteredCount]);

  // Combined list for keyboard navigation
  const allDisplayedItems = useMemo(
    () => [...filteredItems, ...aiSuggestions],
    [filteredItems, aiSuggestions],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      // Popover navigation
      if (popoverMode && allDisplayedItems.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setSelectedIndex((prev) => (prev + 1) % allDisplayedItems.length);
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setSelectedIndex((prev) => (prev - 1 + allDisplayedItems.length) % allDisplayedItems.length);
          return;
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault();
          if (allDisplayedItems[selectedIndex]) {
            insertItem(allDisplayedItems[selectedIndex]);
          }
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          closePopover();
          return;
        }
      }

      // Backspace removes badge when input is empty
      if (e.key === 'Backspace' && badge && !inputValue) {
        e.preventDefault();
        removeBadge();
        return;
      }

      // Escape removes badge
      if (e.key === 'Escape' && badge) {
        e.preventDefault();
        removeBadge();
        return;
      }
    },
    [popoverMode, selectedIndex, insertItem, closePopover, badge, inputValue, removeBadge, allDisplayedItems]
  );

  // Click outside to close popover
  useEffect(() => {
    if (!popoverMode) return;
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        closePopover();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [popoverMode, closePopover]);

  // Click outside to close model menu
  useEffect(() => {
    if (!modelMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (modelMenuRef.current && !modelMenuRef.current.contains(e.target as Node)) {
        setModelMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [modelMenuOpen]);

  // Team menu: 可换队时才拉团队列表;外点关闭同模型菜单
  useEffect(() => {
    if (!onTeamChange) return;
    fetch('/api/teams')
      .then((r) => r.json())
      .then((d: { teams?: Array<{ id: string; name: string; memberRefs: unknown[] }> }) => {
        setTeamOptions((d.teams || []).map((t) => ({ id: t.id, name: t.name, memberCount: t.memberRefs.length })));
      })
      .catch(() => setTeamOptions([]));
  }, [onTeamChange]);
  useEffect(() => {
    if (!teamMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (teamMenuRef.current && !teamMenuRef.current.contains(e.target as Node)) {
        setTeamMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [teamMenuOpen]);

  useEffect(() => {
    if (!knowledgeMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (knowledgeMenuRef.current && !knowledgeMenuRef.current.contains(e.target as Node)) {
        setKnowledgeMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [knowledgeMenuOpen]);

  const handleKnowledgeEnabledChange = useCallback((nextEnabled: boolean) => {
    setKnowledgeEnabled(nextEnabled);
    onKnowledgeOptionsChange?.({
      enabled: nextEnabled,
      tagIds: selectedKnowledgeTagIds,
      ...(Object.keys(knowledgeOverrides).length > 0 ? { overrides: knowledgeOverrides } : {}),
    });
  }, [knowledgeOverrides, onKnowledgeOptionsChange, selectedKnowledgeTagIds]);

  const handleKnowledgeTagIdsChange = useCallback((nextTagIds: string[]) => {
    setSelectedKnowledgeTagIds(nextTagIds);
    onKnowledgeOptionsChange?.({
      enabled: knowledgeEnabled,
      tagIds: nextTagIds,
      ...(Object.keys(knowledgeOverrides).length > 0 ? { overrides: knowledgeOverrides } : {}),
    });
  }, [knowledgeEnabled, knowledgeOverrides, onKnowledgeOptionsChange]);

  const handleKnowledgeOverridesChange = useCallback((nextOverrides: KnowledgeOverrides) => {
    setKnowledgeOverrides(nextOverrides);
    onKnowledgeOptionsChange?.({
      enabled: knowledgeEnabled,
      tagIds: selectedKnowledgeTagIds,
      ...(Object.keys(nextOverrides).length > 0 ? { overrides: nextOverrides } : {}),
    });
  }, [knowledgeEnabled, onKnowledgeOptionsChange, selectedKnowledgeTagIds]);

  const currentModelOption = MODEL_OPTIONS.find((m) => m.value === currentModelValue) || MODEL_OPTIONS[0] || null;
  const hasResolvedModel = Boolean(resolvedModelName?.trim());
  const runtimeModelMismatch = hasResolvedModel
    ? !doesResolvedModelMatchRequested(currentModelValue, resolvedModelName)
    : false;
  // Map isStreaming to ChatStatus for PromptInputSubmit
  const chatStatus: ChatStatus = isStreaming ? 'streaming' : 'ready';

  return (
    <div className="bg-background/80 backdrop-blur-lg px-4 py-3">
      <div className={fullWidth ? "mx-auto w-full" : "mx-auto w-full max-w-3xl"}>
        <div className="relative">
          {/* Popover */}
          {popoverMode && (allDisplayedItems.length > 0 || aiSearchLoading) && (() => {
            const builtInItems = filteredItems.filter(item => item.builtIn);
            const projectItems = filteredItems.filter(item => !item.builtIn && item.source === 'project');
            const skillItems = filteredItems.filter(item => !item.builtIn && item.source !== 'project');
            let globalIdx = 0;

            const renderItem = (item: PopoverItem, idx: number) => (
              <button
                key={`${idx}-${item.value}`}
                ref={idx === selectedIndex ? (el) => { el?.scrollIntoView({ block: 'nearest' }); } : undefined}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors",
                  idx === selectedIndex ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
                )}
                onClick={() => insertItem(item)}
                onMouseEnter={() => setSelectedIndex(idx)}
              >
                {popoverMode === 'file' ? (
                  <HugeiconsIcon icon={At} className="h-4 w-4 shrink-0 text-muted-foreground" />
                ) : item.builtIn && item.icon ? (
                  <HugeiconsIcon icon={item.icon} className="h-4 w-4 shrink-0 text-muted-foreground" />
                ) : !item.builtIn && item.source === 'project' ? (
                  <HugeiconsIcon icon={Edit} className="h-4 w-4 shrink-0 text-muted-foreground" />
                ) : !item.builtIn ? (
                  <HugeiconsIcon icon={Globe} className="h-4 w-4 shrink-0 text-muted-foreground" />
                ) : (
                  <HugeiconsIcon icon={CommandIcon} className="h-4 w-4 shrink-0 text-muted-foreground" />
                )}
                <span className="font-mono text-xs truncate">{item.label}</span>
                {(item.descriptionKey || item.description) && (
                  <span className="text-xs text-muted-foreground truncate max-w-[200px]">
                    {item.descriptionKey ? t(item.descriptionKey) : item.description}
                  </span>
                )}
                {!item.builtIn && item.installedSource && (
                  <span className="text-xs text-muted-foreground shrink-0 ml-auto">
                    {item.installedSource === 'claude' ? t('messageInput.personal') : t('messageInput.agents')}
                  </span>
                )}
              </button>
            );

            return (
              <div
                ref={popoverRef}
                className="absolute bottom-full left-0 right-0 mb-2 rounded-xl border bg-popover shadow-lg overflow-hidden z-50"
              >
                {popoverMode === 'skill' ? (
                  <div className="px-3 py-2 border-b">
                    <input
                      ref={searchInputRef}
                      type="text"
                      placeholder={t('messageInput.search')}
                      value={popoverFilter}
                      onChange={(e) => {
                        const val = e.target.value;
                        setPopoverFilter(val);
                        setSelectedIndex(0);
                        // Sync textarea: replace the filter portion after /
                        if (triggerPos !== null) {
                          const before = inputValue.slice(0, triggerPos + 1);
                          setInputValue(before + val);
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'ArrowDown') {
                          e.preventDefault();
                          setSelectedIndex((prev) => (prev + 1) % allDisplayedItems.length);
                        } else if (e.key === 'ArrowUp') {
                          e.preventDefault();
                          setSelectedIndex((prev) => (prev - 1 + allDisplayedItems.length) % allDisplayedItems.length);
                        } else if (e.key === 'Enter' || e.key === 'Tab') {
                          e.preventDefault();
                          if (allDisplayedItems[selectedIndex]) {
                            insertItem(allDisplayedItems[selectedIndex]);
                          }
                        } else if (e.key === 'Escape') {
                          e.preventDefault();
                          closePopover();
                          textareaRef.current?.focus();
                        }
                      }}
                      className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
                      autoFocus
                    />
                  </div>
                ) : (
                  <div className="px-3 py-2 text-xs font-medium text-muted-foreground border-b">
                    {t('messageInput.files')}
                  </div>
                )}
                <div className="max-h-48 overflow-y-auto py-1">
                  {popoverMode === 'file' ? (
                    filteredItems.map((item, i) => renderItem(item, i))
                  ) : (
                    <>
                      {builtInItems.length > 0 && (
                        <>
                          <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground">
                            {t('messageInput.commands')}
                          </div>
                          {builtInItems.map((item) => {
                            const idx = globalIdx++;
                            return renderItem(item, idx);
                          })}
                        </>
                      )}
                      {projectItems.length > 0 && (
                        <>
                          <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground">
                            {t('messageInput.projectCommands')}
                          </div>
                          {projectItems.map((item) => {
                            const idx = globalIdx++;
                            return renderItem(item, idx);
                          })}
                        </>
                      )}
                      {skillItems.length > 0 && (
                        <>
                          <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground">
                            {t('messageInput.skills')}
                          </div>
                          {skillItems.map((item) => {
                            const idx = globalIdx++;
                            return renderItem(item, idx);
                          })}
                        </>
                      )}
                      {/* AI Suggested section */}
                      {(aiSuggestions.length > 0 || aiSearchLoading) && (
                        <>
                          <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                            <HugeiconsIcon icon={Brain} className="h-3.5 w-3.5" />
                            {t('messageInput.aiSuggested')}
                            {aiSearchLoading && (
                              <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                            )}
                          </div>
                          {aiSuggestions.map((item) => {
                            const idx = globalIdx++;
                            return renderItem(item, idx);
                          })}
                        </>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })()}

          {knowledgeMenuOpen && (
            <div
              ref={knowledgeMenuRef}
              className="absolute bottom-full left-0 mb-2 w-full max-w-sm rounded-xl border bg-popover shadow-lg overflow-hidden z-40"
            >
              <KnowledgeMenuPanel
                enabled={knowledgeEnabled}
                onEnabledChange={handleKnowledgeEnabledChange}
                selectedTagIds={selectedKnowledgeTagIds}
                onSelectedTagIdsChange={handleKnowledgeTagIdsChange}
                overrides={knowledgeOverrides}
                onOverridesChange={handleKnowledgeOverridesChange}
              />
            </div>
          )}

          {/* PromptInput replaces the old input area */}
          <PromptInput
            onSubmit={handleSubmit}
            accept={ACCEPTED_FILE_TYPES}
            multiple
          >
            {/* Bridge: listens for file tree "+" button events */}
            <FileTreeAttachmentBridge />
            {/* Command badge */}
            {badge && (
              <div className="flex w-full items-center gap-1.5 px-3 pt-2.5 pb-0 order-first">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 pl-2.5 pr-1.5 py-1 text-xs font-medium border border-blue-500/20">
                  <span className="font-mono">{badge.command}</span>
                  {badge.description && (
                    <span className="text-blue-500/60 dark:text-blue-400/60 text-[10px]">{badge.description}</span>
                  )}
                  <button
                    type="button"
                    onClick={removeBadge}
                    className="ml-0.5 rounded-full p-0.5 hover:bg-blue-500/20 transition-colors"
                  >
                    <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M3 3l6 6M9 3l-6 6" />
                    </svg>
                  </button>
                </span>
              </div>
            )}
            {/* File attachment capsules */}
            <FileAttachmentsCapsules />
            {/* URL reference capsules (browser panel "+" button etc.) */}
            {urlReferences.length > 0 && (
              <div className="flex w-full flex-wrap items-center gap-1.5 px-3 pt-2 pb-0 order-first">
                {urlReferences.map((ref) => (
                  <span
                    key={ref.id}
                    className="inline-flex items-center gap-1.5 rounded-full bg-sky-500/10 text-sky-600 dark:text-sky-400 pl-2 pr-1 py-0.5 text-xs font-medium border border-sky-500/20"
                    title={ref.url}
                  >
                    <HugeiconsIcon icon={Globe} className="h-3 w-3" />
                    <span className="max-w-[180px] truncate text-[11px]">{ref.title}</span>
                    <button
                      type="button"
                      onClick={() => setUrlReferences((current) => current.filter((r) => r.id !== ref.id))}
                      className="ml-0.5 rounded-full p-0.5 hover:bg-sky-500/20 transition-colors"
                    >
                      <HugeiconsIcon icon={Cancel} className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            {/* 创作引用 chip：商品标题/评论/评论分析等"加入对话"的内容，发送时合并进消息 */}
            {creationTextRefs.length > 0 && (
              <div className="flex w-full flex-wrap items-center gap-1.5 px-3 pt-2 pb-0 order-first">
                {creationTextRefs.map((ref) => (
                  <span
                    key={ref.id}
                    className="inline-flex items-center gap-1.5 rounded-full border border-violet-500/20 bg-violet-500/10 py-0.5 pl-2 pr-1 text-xs font-medium text-violet-600 dark:text-violet-400"
                    title={ref.text}
                  >
                    <span className="rounded bg-violet-500/20 px-1 text-[9px]">{ref.label}</span>
                    <span className="max-w-[160px] truncate text-[11px]">{ref.text}</span>
                    <button
                      type="button"
                      onClick={() => setCreationTextRefs((current) => current.filter((r) => r.id !== ref.id))}
                      className="ml-0.5 rounded-full p-0.5 transition-colors hover:bg-violet-500/20"
                    >
                      <HugeiconsIcon icon={Cancel} className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            {/* 创作图片引用 chip：带缩略图，发送时转附件 */}
            {creationImageRefs.length > 0 && (
              <div className="flex w-full flex-wrap items-center gap-1.5 px-3 pt-2 pb-0 order-first">
                {creationImageRefs.map((ref) => (
                  <span
                    key={ref.id}
                    className="inline-flex items-center gap-1.5 rounded-full border border-violet-500/20 bg-violet-500/10 py-0.5 pl-1 pr-1 text-xs font-medium text-violet-600 dark:text-violet-400"
                    title={ref.label}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={ref.previewUrl} alt={ref.label} className="h-5 w-5 rounded object-cover" />
                    <span className="max-w-[120px] truncate text-[11px]">{ref.label}</span>
                    <button
                      type="button"
                      onClick={() => setCreationImageRefs((current) => current.filter((r) => r.id !== ref.id))}
                      className="ml-0.5 rounded-full p-0.5 transition-colors hover:bg-violet-500/20"
                    >
                      <HugeiconsIcon icon={Cancel} className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            {imageOptionsOpen && imageProviderConfig && (
              <div className="px-3 pt-2 pb-0 order-first">
                <div className="rounded-xl border border-border/60 bg-muted/20 p-3 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium">本次图片参数</div>
                      <div className="text-xs text-muted-foreground">仅对这条消息里的做图/改图调用生效，优先级高于服务商默认值。</div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => {
                        setImageOptionsOpen(false);
                        setImageOptionsError(null);
                      }}
                    >
                      收起
                    </Button>
                  </div>

                  <ImageGenOptionsFields
                    providerConfig={imageProviderConfig}
                    aspectRatio={imageAspectRatio}
                    resolution={imageResolution}
                    count={imageCount}
                    disabled={disabled || isStreaming}
                    advancedOpen={imageAdvancedOpen}
                    advancedValues={imageAdvancedValues}
                    onAspectRatioChange={(value) => {
                      setImageAspectRatio(value);
                      setImageOptionsError(null);
                    }}
                    onResolutionChange={(value) => {
                      setImageResolution(value);
                      setImageOptionsError(null);
                    }}
                    onCountChange={(value) => {
                      setImageCount(value);
                      setImageOptionsError(null);
                    }}
                    onAdvancedOpenChange={setImageAdvancedOpen}
                    onAdvancedValueChange={(key, value) => {
                      setImageAdvancedValues((prev) => ({ ...prev, [key]: value }));
                      setImageOptionsError(null);
                    }}
                  />

                  {imageOptionsError && (
                    <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                      {imageOptionsError}
                    </div>
                  )}
                </div>
              </div>
            )}
            <PromptInputTextarea
              ref={textareaRef}
              placeholder={badge ? t('messageInput.badgePlaceholder') : t('messageInput.placeholder')}
              value={inputValue}
              onChange={(e) => handleInputChange(e.currentTarget.value)}
              onFocus={onInputFocus}
              onKeyDown={handleKeyDown}
              disabled={disabled}
              className="min-h-10"
            />
            <PromptInputFooter>
              <PromptInputTools>
                {/* Attach file button */}
                <AttachFileButton />

                <div className="relative">
                  <PromptInputButton
                    onClick={() => setKnowledgeMenuOpen((prev) => !prev)}
                    className={cn(
                      knowledgeEnabled && "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/15 dark:text-emerald-300"
                    )}
                  >
                    <HugeiconsIcon icon={Brain} className="h-3.5 w-3.5" />
                    <span className="text-xs">{t('messageInput.knowledgeBase')}</span>
                    {knowledgeEnabled && selectedKnowledgeTagIds.length > 0 && (
                      <span className="rounded-full bg-current/10 px-1.5 py-0.5 text-[10px] leading-none">
                        {selectedKnowledgeTagIds.length}
                      </span>
                    )}
                    <HugeiconsIcon
                      icon={ArrowDown01}
                      className={cn("h-2.5 w-2.5 transition-transform duration-200", knowledgeMenuOpen && "rotate-180")}
                    />
                  </PromptInputButton>
                </div>

                {imageProviderConfig && (
                  <PromptInputButton
                    onClick={() => {
                      setImageOptionsOpen((prev) => !prev);
                      setImageOptionsError(null);
                    }}
                    className={cn(
                      imageOptionsOpen && "border-blue-500/40 bg-blue-500/10 text-blue-700 hover:bg-blue-500/15 dark:text-blue-300"
                    )}
                  >
                    <HugeiconsIcon icon={Edit} className="h-3.5 w-3.5" />
                    <span className="text-xs">图片参数</span>
                    <span className="rounded-full bg-current/10 px-1.5 py-0.5 text-[10px] leading-none">
                      {imageAspectRatio}/{imageResolution}
                    </span>
                  </PromptInputButton>
                )}

                {/* 团队选择:与模型选择器同行。可换队(空会话)是下拉;已开始只显徽标 */}
                {(onTeamChange ? teamOptions.length > 0 : Boolean(teamName)) && (
                  <div className="relative flex items-center" ref={teamMenuRef}>
                    <PromptInputButton
                      onClick={() => { if (onTeamChange) setTeamMenuOpen((prev) => !prev); }}
                      className={cn(teamId && "border-primary/30 bg-primary/10 text-primary hover:bg-primary/15")}
                      tooltip={onTeamChange ? undefined : '会话已开始,团队不可更换'}
                    >
                      <span className="text-xs">{teamName || '团队'}</span>
                      {onTeamChange && (
                        <HugeiconsIcon icon={ArrowDown01} className={cn("h-2.5 w-2.5 transition-transform duration-200", teamMenuOpen && "rotate-180")} />
                      )}
                    </PromptInputButton>
                    {teamMenuOpen && (
                      <div className="absolute bottom-full left-0 mb-1.5 w-56 rounded-lg border bg-popover shadow-lg overflow-hidden z-50 max-h-72 overflow-y-auto">
                        <button
                          type="button"
                          className={cn("w-full px-3 py-2 text-left text-xs hover:bg-accent", !teamId && "bg-accent/50 font-medium")}
                          onClick={() => { onTeamChange?.('', ''); setTeamMenuOpen(false); }}
                        >
                          不用团队(普通对话)
                        </button>
                        {teamOptions.map((option) => (
                          <button
                            key={option.id}
                            type="button"
                            className={cn("w-full px-3 py-2 text-left text-xs hover:bg-accent", teamId === option.id && "bg-accent/50 font-medium")}
                            onClick={() => { onTeamChange?.(option.id, option.name); setTeamMenuOpen(false); }}
                          >
                            {option.name}
                            <span className="ml-1 text-muted-foreground">({option.memberCount}人)</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Model selector */}
                <div className="relative flex items-center gap-1" ref={modelMenuRef}>
                  {hasProviders && currentModelOption ? (
                    <>
                      <PromptInputButton
                        onClick={() => setModelMenuOpen((prev) => !prev)}
                        className={cn(
                          runtimeModelMismatch && "border-amber-500/40 bg-amber-500/10 text-amber-700 hover:bg-amber-500/15 dark:text-amber-300"
                        )}
                        tooltip={runtimeModelMismatch ? `实际运行：${resolvedModelName}` : undefined}
                      >
                        <span className="text-[10px] text-muted-foreground leading-none">
                          {currentGroup?.provider_name}
                        </span>
                        <span className="mx-0.5 text-muted-foreground/40">/</span>
                        <span className="text-xs font-mono">{currentModelOption.label}</span>
                        {runtimeModelMismatch && (
                          <span className="h-1.5 w-1.5 rounded-full bg-amber-500 flex-shrink-0" />
                        )}
                        <HugeiconsIcon icon={ArrowDown01} className={cn("h-2.5 w-2.5 transition-transform duration-200", modelMenuOpen && "rotate-180")} />
                      </PromptInputButton>

                      {runtimeModelMismatch && (
                        <div className="hidden h-7 max-w-52 items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[10px] text-amber-700 dark:text-amber-300 sm:flex">
                          <span className="shrink-0">实际</span>
                          <span className="truncate font-mono">{resolvedModelName}</span>
                        </div>
                      )}

                      {modelMenuOpen && (
                        <div className="absolute bottom-full left-0 mb-1.5 w-72 rounded-lg border bg-popover shadow-lg overflow-hidden z-50 max-h-96 overflow-y-auto">
                          {selectableProviderGroups.map((group, groupIndex) => {
                            const isCurrent = group.provider_id === currentProviderIdValue;
                            return (
                              <div
                                key={group.provider_id}
                                className={cn(groupIndex > 0 && "border-t")}
                              >
                                <div className={cn("px-3 py-1.5", isCurrent ? "bg-accent/30" : "bg-muted/30")}>
                                  <div className="flex items-center gap-2">
                                    <span className={cn(
                                      "h-1.5 w-1.5 rounded-full flex-shrink-0",
                                      isCurrent ? "bg-primary" : "bg-muted-foreground/30"
                                    )} />
                                    <span className="truncate text-xs font-medium">{group.provider_name}</span>
                                    {isCurrent && (
                                      <span className="ml-auto text-[10px] text-primary font-medium">当前</span>
                                    )}
                                  </div>
                                  {isCurrent && runtimeModelMismatch && (
                                    <div className="mt-1 ml-3.5 rounded bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-700 dark:text-amber-300">
                                      实际运行：<span className="font-mono">{resolvedModelName}</span>
                                    </div>
                                  )}
                                </div>
                                <div className="py-0.5">
                                  {group.models.map((opt) => {
                                    const isActive = opt.value === currentModelValue && isCurrent;
                                    const inputPrice = formatYuanPerMtok(opt.input_price_per_mtok);
                                    const outputPrice = formatYuanPerMtok(opt.output_price_per_mtok);
                                    const hasPricing = Boolean(inputPrice || outputPrice);
                                    return (
                                      <button
                                        key={`${group.provider_id}-${opt.value}`}
                                        className={cn(
                                          "flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left transition-colors",
                                          isActive
                                            ? "bg-accent text-accent-foreground"
                                            : "hover:bg-accent/50"
                                        )}
                                        onClick={() => {
                                          persistStoredChatSelection(group.provider_id, opt.value);
                                          setStoredProviderId(group.provider_id);
                                          setStoredModel(opt.value);
                                          onModelChange?.(opt.value);
                                          onProviderModelChange?.(group.provider_id, opt.value);
                                          setModelMenuOpen(false);
                                        }}
                                      >
                                        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                                          <span className="truncate font-mono text-xs">{opt.label}</span>
                                          {hasPricing && (
                                            <span className="text-[10px] text-muted-foreground leading-none">
                                              输入 {inputPrice ?? '—'} <span className="text-muted-foreground/50">·</span> 输出 {outputPrice ?? '—'}
                                              <span className="text-muted-foreground/50"> / 1M tokens</span>
                                            </span>
                                          )}
                                        </div>
                                        {isActive && (
                                          <span className="text-primary text-xs flex-shrink-0">&#10003;</span>
                                        )}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </>
                  ) : (
                    <a
                      href="/settings"
                      className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[11px] text-amber-700 hover:bg-amber-500/20 dark:text-amber-300 transition-colors"
                    >
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
                      <span>未配置 AI 服务</span>
                      <span className="text-amber-700/60 dark:text-amber-300/60">·</span>
                      <span className="underline underline-offset-2">前往设置</span>
                    </a>
                  )}
                </div>

              </PromptInputTools>

              <FileAwareSubmitButton
                status={chatStatus}
                onStop={onStop}
                disabled={disabled || !hasProviders}
                inputValue={inputValue}
                hasBadge={!!badge}
              />
            </PromptInputFooter>
          </PromptInput>
        </div>
      </div>

    </div>
  );
}
