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
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/i18n';
import {
  DEFAULT_PROVIDER_MODEL_OPTIONS,
  doesResolvedModelMatchRequested,
} from '@/lib/model-metadata';
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputTools,
  PromptInputButton,
  PromptInputSubmit,
  usePromptInputAttachments,
} from '@/components/ai-elements/prompt-input';
import type { ChatStatus } from 'ai';
import type { ChatKnowledgeOptions, FileAttachment, ProviderModelGroup } from '@/types';
import { nanoid } from 'nanoid';

// Accepted file types for upload
const ACCEPTED_FILE_TYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'application/pdf',
  'text/*',
  '.md', '.json', '.csv', '.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs',
].join(',');

// Max file sizes
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;  // 5MB
const MAX_DOC_SIZE = 10 * 1024 * 1024;   // 10MB
const MAX_FILE_SIZE = MAX_DOC_SIZE;       // Use larger limit; we validate per-type in conversion

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
  onInputFocus?: () => void;
  fullWidth?: boolean;
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

interface KnowledgeTag {
  id: string;
  name: string;
  category: string;
  color: string;
  usage_count?: number;
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

interface ChatDraftPayload {
  text: string;
  mode?: 'replace' | 'append';
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
  if (TEXT_EXTS[ext]) return TEXT_EXTS[ext];
  if (IMAGE_EXTS[ext]) return IMAGE_EXTS[ext];
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
  onInputFocus,
  fullWidth = false,
}: MessageInputProps) {
  const { t } = useTranslation();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const modelMenuRef = useRef<HTMLDivElement>(null);
  const knowledgeMenuRef = useRef<HTMLDivElement>(null);

  const [popoverMode, setPopoverMode] = useState<PopoverMode>(null);
  const [popoverItems, setPopoverItems] = useState<PopoverItem[]>([]);
  const [popoverFilter, setPopoverFilter] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [triggerPos, setTriggerPos] = useState<number | null>(null);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [badge, setBadge] = useState<CommandBadge | null>(null);
  const [providerGroups, setProviderGroups] = useState<ProviderModelGroup[]>([]);
  const [defaultProviderId, setDefaultProviderId] = useState<string>('');
  const [aiSuggestions, setAiSuggestions] = useState<PopoverItem[]>([]);
  const [aiSearchLoading, setAiSearchLoading] = useState(false);
  const [knowledgeEnabled, setKnowledgeEnabled] = useState(initialKnowledgeEnabled);
  const [knowledgeMenuOpen, setKnowledgeMenuOpen] = useState(false);
  const [knowledgeTags, setKnowledgeTags] = useState<KnowledgeTag[]>([]);
  const [knowledgeTagsLoading, setKnowledgeTagsLoading] = useState(false);
  const [knowledgeTagsError, setKnowledgeTagsError] = useState<string | null>(null);
  const [knowledgeTagFilter, setKnowledgeTagFilter] = useState('');
  const [selectedKnowledgeTagIds, setSelectedKnowledgeTagIds] = useState<string[]>([]);
  const aiSearchAbortRef = useRef<AbortController | null>(null);
  const aiSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setKnowledgeEnabled(initialKnowledgeEnabled);
  }, [initialKnowledgeEnabled]);

  // Fetch provider groups from API
  const fetchProviderModels = useCallback(() => {
    fetch('/api/providers/models')
      .then((r) => r.json())
      .then((data) => {
        setProviderGroups(data.groups || []);
        setDefaultProviderId(data.default_provider_id || '');
      })
      .catch(() => {
        setProviderGroups([]);
        setDefaultProviderId('');
      });
  }, []);

  const fetchKnowledgeTags = useCallback(async () => {
    setKnowledgeTagsLoading(true);
    setKnowledgeTagsError(null);

    try {
      const response = await fetch('/api/knowledge/tags');
      if (!response.ok) {
        throw new Error('Failed to load knowledge tags');
      }

      const data = await response.json();
      const tags = Array.isArray(data)
        ? data
            .map((tag): KnowledgeTag | null => {
              if (!tag || typeof tag !== 'object') return null;
              const record = tag as Record<string, unknown>;
              const id = typeof record.id === 'string' ? record.id.trim() : '';
              const name = typeof record.name === 'string' ? record.name.trim() : '';
              if (!id || !name) return null;
              return {
                id,
                name,
                category: typeof record.category === 'string' ? record.category : 'custom',
                color: typeof record.color === 'string' && record.color.trim() ? record.color : '#6B7280',
                usage_count: typeof record.usage_count === 'number' ? record.usage_count : 0,
              };
            })
            .filter((tag): tag is KnowledgeTag => tag !== null)
        : [];

      setKnowledgeTags(tags);
    } catch (error) {
      setKnowledgeTagsError(error instanceof Error ? error.message : 'Failed to load knowledge tags');
    } finally {
      setKnowledgeTagsLoading(false);
    }
  }, []);

  // Load models on mount and listen for provider changes
  useEffect(() => {
    fetchProviderModels();
    const handler = () => fetchProviderModels();
    window.addEventListener('provider-changed', handler);
    return () => window.removeEventListener('provider-changed', handler);
  }, [fetchProviderModels]);

  useEffect(() => {
    if (!knowledgeMenuOpen) return;
    if (knowledgeTagsLoading || knowledgeTags.length > 0 || knowledgeTagsError) return;
    void fetchKnowledgeTags();
  }, [fetchKnowledgeTags, knowledgeMenuOpen, knowledgeTags.length, knowledgeTagsError, knowledgeTagsLoading]);

  // Derive active provider + model for the selector.
  const hasExplicitProvider = !!providerId && providerGroups.some((group) => group.provider_id === providerId);
  const hasDefaultProvider = !!defaultProviderId && providerGroups.some((group) => group.provider_id === defaultProviderId);
  const currentProviderIdValue = hasExplicitProvider
    ? (providerId as string)
    : hasDefaultProvider
      ? defaultProviderId
      : (providerGroups[0]?.provider_id ?? '');
  const hasProviders = providerGroups.length > 0;
  const currentGroup = providerGroups.find(g => g.provider_id === currentProviderIdValue) || providerGroups[0];
  const MODEL_OPTIONS = currentGroup?.models || (hasProviders ? DEFAULT_PROVIDER_MODEL_OPTIONS : []);

  useEffect(() => {
    if (MODEL_OPTIONS.length === 0) return;

    const nextProviderId = currentProviderIdValue;
    const currentValue = modelName || '';
    const hasSelectedModel = MODEL_OPTIONS.some((model) => model.value === currentValue);
    const fallbackModel = hasSelectedModel ? currentValue : MODEL_OPTIONS[0].value;
    const providerMissing = !providerId || !hasExplicitProvider;
    const modelChanged = currentValue !== fallbackModel;

    if (providerMissing && nextProviderId && onProviderModelChange) {
      onProviderModelChange(nextProviderId, fallbackModel);
      return;
    }

    if (modelChanged) {
      onModelChange?.(fallbackModel);
    }
  }, [
    MODEL_OPTIONS,
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

  const handleSubmit = useCallback(async (msg: { text: string; files: Array<{ id?: string; type: string; url: string; filename?: string; mediaType?: string; filePath?: string }> }, e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const content = inputValue.trim();

    closePopover();

    // Convert PromptInput FileUIParts (with data URLs) to FileAttachment[]
    const convertFiles = async (): Promise<FileAttachment[]> => {
      if (!msg.files || msg.files.length === 0) return [];

      const attachments: FileAttachment[] = [];
      for (const file of msg.files) {
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
              name: file.filename || 'file',
              type: file.mediaType || 'application/octet-stream',
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
          // Existing logic: user-uploaded files with blob URLs
          try {
            const attachment = await dataUrlToFileAttachment(
              file.url,
              file.filename || 'file',
              file.mediaType || 'application/octet-stream',
            );
            // Enforce per-type size limits
            const isImage = attachment.type.startsWith('image/');
            const sizeLimit = isImage ? MAX_IMAGE_SIZE : MAX_DOC_SIZE;
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

      const files = await convertFiles();
      const knowledgeOptions: ChatKnowledgeOptions = {
        enabled: knowledgeEnabled,
        tagIds: selectedKnowledgeTagIds,
      };
      setBadge(null);
      setInputValue('');
      onSend(finalPrompt, files.length > 0 ? files : undefined, undefined, undefined, knowledgeOptions);
      return;
    }

    const files = await convertFiles();
    const hasFiles = files.length > 0;

    if ((!content && !hasFiles) || disabled || isStreaming || !hasProviders) return;

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

    onSend(
      content || 'Please review the attached file(s).',
      hasFiles ? files : undefined,
      undefined,
      undefined,
      {
        enabled: knowledgeEnabled,
        tagIds: selectedKnowledgeTagIds,
      },
    );
    setInputValue('');
  }, [
    badge,
    closePopover,
    disabled,
    inputValue,
    isStreaming,
    knowledgeEnabled,
    onCommand,
    onSend,
    selectedKnowledgeTagIds,
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

  const currentModelValue = MODEL_OPTIONS.length > 0
    ? (MODEL_OPTIONS.some((model) => model.value === (modelName || ''))
        ? (modelName || '')
        : MODEL_OPTIONS[0].value)
    : '';
  const currentModelOption = MODEL_OPTIONS.find((m) => m.value === currentModelValue) || MODEL_OPTIONS[0] || null;
  const hasResolvedModel = Boolean(resolvedModelName?.trim());
  const runtimeModelMismatch = hasResolvedModel
    ? !doesResolvedModelMatchRequested(currentModelValue, resolvedModelName)
    : false;
  const knowledgeTagQuery = knowledgeTagFilter.trim().toLowerCase();
  const filteredKnowledgeTags = knowledgeTags.filter((tag) => {
    if (!knowledgeTagQuery) return true;
    return tag.name.toLowerCase().includes(knowledgeTagQuery)
      || tag.category.toLowerCase().includes(knowledgeTagQuery);
  });
  const selectedKnowledgeTags = knowledgeTags.filter((tag) => selectedKnowledgeTagIds.includes(tag.id));

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
              <div className="flex items-start justify-between gap-3 border-b px-3 py-3">
                <div className="space-y-1">
                  <div className="text-sm font-medium">{t('messageInput.knowledgeBase')}</div>
                  <div className="text-xs text-muted-foreground">
                    {knowledgeEnabled
                      ? t('messageInput.knowledgeEnabledHint')
                      : t('messageInput.knowledgeDisabledHint')}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setKnowledgeEnabled((prev) => !prev)}
                  className={cn(
                    "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors",
                    knowledgeEnabled
                      ? "border-emerald-500/40 bg-emerald-500/20"
                      : "border-border bg-muted"
                  )}
                  aria-pressed={knowledgeEnabled}
                >
                  <span
                    className={cn(
                      "inline-block h-4 w-4 rounded-full bg-background shadow-sm transition-transform",
                      knowledgeEnabled ? "translate-x-6" : "translate-x-1"
                    )}
                  />
                </button>
              </div>

              {knowledgeEnabled && (
                <>
                  <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
                    <div>
                      <div className="text-xs font-medium text-foreground">{t('messageInput.knowledgeTags')}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {selectedKnowledgeTagIds.length > 0
                          ? t('messageInput.knowledgeTagsSelected').replace('{n}', String(selectedKnowledgeTagIds.length))
                          : t('messageInput.knowledgeAllTags')}
                      </div>
                    </div>
                    {selectedKnowledgeTagIds.length > 0 && (
                      <button
                        type="button"
                        className="text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                        onClick={() => setSelectedKnowledgeTagIds([])}
                      >
                        {t('messageInput.knowledgeClearTags')}
                      </button>
                    )}
                  </div>

                  {selectedKnowledgeTags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 border-b px-3 py-2">
                      {selectedKnowledgeTags.map((tag) => (
                        <button
                          key={`selected-${tag.id}`}
                          type="button"
                          onClick={() => {
                            setSelectedKnowledgeTagIds((prev) => prev.filter((id) => id !== tag.id));
                          }}
                          className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-700 transition-colors hover:bg-emerald-500/15 dark:text-emerald-300"
                        >
                          <span
                            className="h-1.5 w-1.5 rounded-full"
                            style={{ backgroundColor: tag.color }}
                          />
                          <span className="max-w-[140px] truncate">{tag.name}</span>
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="border-b px-3 py-2">
                    <input
                      type="text"
                      value={knowledgeTagFilter}
                      onChange={(e) => setKnowledgeTagFilter(e.target.value)}
                      placeholder={t('messageInput.knowledgeFilterPlaceholder')}
                      className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs outline-none transition-colors focus:border-ring"
                    />
                  </div>

                  <div className="max-h-52 overflow-y-auto p-2">
                    {knowledgeTagsLoading ? (
                      <div className="px-2 py-3 text-xs text-muted-foreground">
                        {t('messageInput.knowledgeLoadingTags')}
                      </div>
                    ) : knowledgeTagsError ? (
                      <div className="space-y-2 px-2 py-3">
                        <div className="text-xs text-destructive">{t('messageInput.knowledgeLoadTagsFailed')}</div>
                        <button
                          type="button"
                          className="text-xs text-foreground underline underline-offset-2"
                          onClick={() => void fetchKnowledgeTags()}
                        >
                          {t('install.retry')}
                        </button>
                      </div>
                    ) : filteredKnowledgeTags.length === 0 ? (
                      <div className="px-2 py-3 text-xs text-muted-foreground">
                        {knowledgeTags.length === 0
                          ? t('messageInput.knowledgeNoTags')
                          : t('messageInput.knowledgeNoFilteredTags')}
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {filteredKnowledgeTags.map((tag) => {
                          const isSelected = selectedKnowledgeTagIds.includes(tag.id);
                          return (
                            <button
                              key={tag.id}
                              type="button"
                              onClick={() => {
                                setSelectedKnowledgeTagIds((prev) => (
                                  prev.includes(tag.id)
                                    ? prev.filter((id) => id !== tag.id)
                                    : [...prev, tag.id]
                                ));
                              }}
                              className={cn(
                                "inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs transition-colors",
                                isSelected
                                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                                  : "border-border bg-background text-muted-foreground hover:text-foreground"
                              )}
                            >
                              <span
                                className="h-1.5 w-1.5 rounded-full shrink-0"
                                style={{ backgroundColor: tag.color }}
                              />
                              <span className="truncate">{tag.name}</span>
                              {typeof tag.usage_count === 'number' && tag.usage_count > 0 && (
                                <span className="text-[10px] opacity-70">{tag.usage_count}</span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {/* PromptInput replaces the old input area */}
          <PromptInput
            onSubmit={handleSubmit}
            accept={ACCEPTED_FILE_TYPES}
            multiple
            maxFileSize={MAX_FILE_SIZE}
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
                          {providerGroups.map((group, groupIndex) => {
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
                                          onModelChange?.(opt.value);
                                          onProviderModelChange?.(group.provider_id, opt.value);
                                          localStorage.setItem('lumos:last-model', opt.value);
                                          setModelMenuOpen(false);
                                        }}
                                      >
                                        <span className="truncate font-mono text-xs">{opt.label}</span>
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
