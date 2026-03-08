'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import type { Message, TokenUsage, FileAttachment } from '@/types';
import {
  Message as AIMessage,
  MessageContent,
  MessageResponse,
} from '@/components/ai-elements/message';
import { ToolActionsGroup } from '@/components/ai-elements/tool-actions-group';
import { HugeiconsIcon } from "@hugeicons/react";
import { Copy, Tick, ArrowDown01, ArrowUp01 } from "@hugeicons/core-free-icons";
import { FileAttachmentDisplay } from './FileAttachmentDisplay';
import { useTranslation } from '@/hooks/useTranslation';
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ImageGenConfirmation } from './ImageGenConfirmation';
import { ImageGenCard } from './ImageGenCard';
import { ArtifactReferencePreview } from './ArtifactReferencePreview';
import { BatchPlanInlinePreview } from './batch-image-gen/BatchPlanInlinePreview';
import { buildReferenceImages } from '@/lib/image-ref-store';
import { parseDBDate } from '@/lib/utils';
import type { PlannerOutput } from '@/types';
import { ExtensionPlanCard } from '@/components/extensions/ExtensionPlanCard';

interface ImageGenRequest {
  prompt: string;
  aspectRatio: string;
  resolution: string;
  referenceImages?: string[];
  useLastGenerated?: boolean;
}

function parseImageGenRequest(text: string): { beforeText: string; request: ImageGenRequest; afterText: string } | null {
  const regex = /```image-gen-request\s*\n?([\s\S]*?)\n?\s*```/;
  const match = text.match(regex);
  if (!match) return null;
  try {
    let raw = match[1].trim();
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(raw);
    } catch {
      // Attempt to fix common model output issues: unescaped quotes in values
      raw = raw.replace(/"prompt"\s*:\s*"([\s\S]*?)"\s*([,}])/g, (_m, val, tail) => {
        const escaped = val.replace(/(?<!\\)"/g, '\\"');
        return `"prompt": "${escaped}"${tail}`;
      });
      json = JSON.parse(raw);
    }
    const beforeText = text.slice(0, match.index).trim();
    const afterText = text.slice((match.index || 0) + match[0].length).trim();
    return {
      beforeText,
      request: {
        prompt: String(json.prompt || ''),
        aspectRatio: String(json.aspectRatio || '1:1'),
        resolution: String(json.resolution || '1K'),
        referenceImages: Array.isArray(json.referenceImages) ? json.referenceImages : undefined,
        useLastGenerated: json.useLastGenerated === true,
      },
      afterText,
    };
  } catch {
    return null;
  }
}

interface ImageGenResultData {
  status: 'generating' | 'completed' | 'error';
  prompt: string;
  aspectRatio?: string;
  resolution?: string;
  model?: string;
  images?: Array<{ mimeType: string; localPath?: string; data?: string }>;
  error?: string;
}

function parseImageGenResult(text: string): { beforeText: string; result: ImageGenResultData; afterText: string } | null {
  const regex = /```image-gen-result\s*\n?([\s\S]*?)\n?\s*```/;
  const match = text.match(regex);
  if (!match) return null;
  try {
    const json = JSON.parse(match[1]);
    const beforeText = text.slice(0, match.index).trim();
    const afterText = text.slice((match.index || 0) + match[0].length).trim();
    return {
      beforeText,
      result: {
        status: json.status || 'completed',
        prompt: String(json.prompt || ''),
        aspectRatio: json.aspectRatio,
        resolution: json.resolution,
        model: json.model,
        images: Array.isArray(json.images) ? json.images : undefined,
        error: json.error,
      },
      afterText,
    };
  } catch {
    return null;
  }
}

function parseBatchPlan(text: string): { beforeText: string; plan: PlannerOutput; afterText: string } | null {
  const regex = /```batch-plan\s*\n?([\s\S]*?)\n?\s*```/;
  const match = text.match(regex);
  if (!match) return null;
  try {
    const json = JSON.parse(match[1]);
    const beforeText = text.slice(0, match.index).trim();
    const afterText = text.slice((match.index || 0) + match[0].length).trim();
    return {
      beforeText,
      plan: {
        summary: json.summary || '',
        items: Array.isArray(json.items) ? json.items.map((item: Record<string, unknown>) => ({
          prompt: String(item.prompt || ''),
          aspectRatio: String(item.aspectRatio || '1:1'),
          resolution: String(item.resolution || '1K'),
          tags: Array.isArray(item.tags) ? item.tags : [],
          sourceRefs: Array.isArray(item.sourceRefs) ? item.sourceRefs : [],
        })) : [],
      },
      afterText,
    };
  } catch {
    return null;
  }
}

type ExtensionPlan = {
  type?: string;
  summary?: string;
  skills?: Array<{ name?: string; description?: string; content?: string }>;
  mcpServers?: Array<{
    name?: string;
    description?: string;
    config?: {
      type?: 'stdio' | 'sse' | 'http';
      command?: string;
      args?: string[];
      env?: Record<string, string>;
      url?: string;
      headers?: Record<string, string>;
    };
  }>;
};

function parseExtensionPlan(text: string): { beforeText: string; plan: ExtensionPlan; afterText: string } | null {
  const regex = /```lumos-extension-plan\s*\n?([\s\S]*?)\n?\s*```/;
  const match = text.match(regex);
  if (!match) return null;
  try {
    const json = JSON.parse(match[1]);
    const beforeText = text.slice(0, match.index).trim();
    const afterText = text.slice((match.index || 0) + match[0].length).trim();
    return {
      beforeText,
      plan: json,
      afterText,
    };
  } catch {
    return null;
  }
}

interface MessageItemProps {
  message: Message;
}

interface ToolBlock {
  type: 'tool_use' | 'tool_result';
  id?: string;
  name?: string;
  input?: unknown;
  content?: string;
  is_error?: boolean;
}

function parseToolBlocks(content: string): { text: string; tools: ToolBlock[] } {
  const tools: ToolBlock[] = [];
  let text = '';

  // Try to parse as JSON array (new format from chat API)
  if (content.startsWith('[')) {
    try {
      const blocks = JSON.parse(content) as Array<{
        type: string;
        text?: string;
        id?: string;
        name?: string;
        input?: unknown;
        tool_use_id?: string;
        content?: string;
        is_error?: boolean;
      }>;
      
      for (const block of blocks) {
        if (block.type === 'text' && block.text) {
          text += block.text;
        } else if (block.type === 'tool_use') {
          tools.push({
            type: 'tool_use',
            id: block.id,
            name: block.name,
            input: block.input,
          });
        } else if (block.type === 'tool_result') {
          tools.push({
            type: 'tool_result',
            id: block.tool_use_id,
            content: block.content,
            is_error: block.is_error,
          });
        }
      }
      
      return { text: text.trim(), tools };
    } catch {
      // Not valid JSON, fall through to legacy parsing
    }
  }

  // Legacy format: HTML comments
  text = content;
  const toolUseRegex = /<!--tool_use:([\s\S]*?)-->/g;
  let match;
  while ((match = toolUseRegex.exec(content)) !== null) {
    try {
      const parsed = JSON.parse(match[1]);
      tools.push({ type: 'tool_use', ...parsed });
    } catch {
      // skip malformed
    }
    text = text.replace(match[0], '');
  }

  const toolResultRegex = /<!--tool_result:([\s\S]*?)-->/g;
  while ((match = toolResultRegex.exec(content)) !== null) {
    try {
      const parsed = JSON.parse(match[1]);
      tools.push({ type: 'tool_result', ...parsed });
    } catch {
      // skip malformed
    }
    text = text.replace(match[0], '');
  }

  return { text: text.trim(), tools };
}

function pairTools(tools: ToolBlock[]): Array<{
  name: string;
  input: unknown;
  result?: string;
  isError?: boolean;
}> {
  const paired: Array<{
    name: string;
    input: unknown;
    result?: string;
    isError?: boolean;
  }> = [];

  const resultMap = new Map<string, ToolBlock>();
  for (const t of tools) {
    if (t.type === 'tool_result' && t.id) {
      resultMap.set(t.id, t);
    }
  }

  for (const t of tools) {
    if (t.type === 'tool_use' && t.name) {
      const result = t.id ? resultMap.get(t.id) : undefined;
      paired.push({
        name: t.name,
        input: t.input,
        result: result?.content,
        isError: result?.is_error,
      });
    }
  }

  for (const t of tools) {
    if (t.type === 'tool_result' && !tools.some(u => u.type === 'tool_use' && u.id === t.id)) {
      paired.push({
        name: 'tool_result',
        input: {},
        result: t.content,
        isError: t.is_error,
      });
    }
  }

  return paired;
}

function parseMessageMeta(content: string): { files: FileAttachment[]; source?: string; text: string } {
  let text = content;
  let files: FileAttachment[] = [];
  let source: string | undefined;

  while (true) {
    const match = text.match(/^<!--(.*?)-->\s*/);
    if (!match) break;
    const payload = match[1] || '';
    if (payload.startsWith('files:')) {
      try {
        files = JSON.parse(payload.slice('files:'.length));
      } catch {
        // ignore parse errors
      }
    } else if (payload.startsWith('source:')) {
      source = payload.slice('source:'.length).trim();
    }
    text = text.slice(match[0].length);
  }

  return { files, source, text };
}

function CopyButton({ text }: { text: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
    }
  }, [text]);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={handleCopy}
          className="cursor-pointer inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground/60 hover:text-muted-foreground hover:bg-muted transition-colors"
        >
          {copied ? (
            <HugeiconsIcon icon={Tick} className="h-3 w-3 text-green-500" />
          ) : (
            <HugeiconsIcon icon={Copy} className="h-3 w-3" />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent>{t('common.copy')}</TooltipContent>
    </Tooltip>
  );
}

function TokenUsageDisplay({ usage }: { usage: TokenUsage }) {
  const totalTokens = usage.input_tokens + usage.output_tokens;
  const costStr = usage.cost_usd !== undefined && usage.cost_usd !== null
    ? ` · $${usage.cost_usd.toFixed(4)}`
    : '';

  return (
    <span className="group/tokens relative cursor-default text-xs text-muted-foreground/50">
      <span>{totalTokens.toLocaleString()} tokens{costStr}</span>
      <span className="pointer-events-none absolute bottom-full left-0 mb-1.5 whitespace-nowrap rounded-md bg-popover px-2.5 py-1.5 text-[11px] text-popover-foreground shadow-md border border-border/50 opacity-0 group-hover/tokens:opacity-100 transition-opacity duration-150 z-50">
        In: {usage.input_tokens.toLocaleString()} · Out: {usage.output_tokens.toLocaleString()}
        {usage.cache_read_input_tokens ? ` · Cache: ${usage.cache_read_input_tokens.toLocaleString()}` : ''}
        {costStr}
      </span>
    </span>
  );
}

const COLLAPSE_HEIGHT = 300;

export function MessageItem({ message }: MessageItemProps) {
  const { t } = useTranslation();
  const isUser = message.role === 'user';
  const shouldHideImageNotice = isUser && message.content.startsWith('[__IMAGE_GEN_NOTICE__');

  // Collapse/expand state for long user messages (hooks must be called unconditionally)
  const [isExpanded, setIsExpanded] = useState(false);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  const { text, tools } = parseToolBlocks(message.content);
  const pairedTools = pairTools(tools);

  // Parse file attachments from user messages
  const { files, source, text: textWithoutMeta } = isUser
    ? parseMessageMeta(text)
    : { files: [], source: undefined, text };

  const displayText = isUser ? textWithoutMeta : text;

  useEffect(() => {
    if (isUser && contentRef.current) {
      setIsOverflowing(contentRef.current.scrollHeight > COLLAPSE_HEIGHT);
    }
  }, [isUser, displayText]);

  // Hide image-gen system notices — they exist in DB for Claude's context but shouldn't render
  if (shouldHideImageNotice) {
    return null;
  }

  let tokenUsage: TokenUsage | null = null;
  if (message.token_usage) {
    try {
      tokenUsage = JSON.parse(message.token_usage);
    } catch {
      // skip
    }
  }

  const timestamp = parseDBDate(message.created_at).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <AIMessage from={isUser ? 'user' : 'assistant'}>
      <MessageContent>
        {/* Source badge for user messages */}
        {isUser && source === 'feishu' && (
          <div className="mb-1">
            <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700 border border-blue-200">
              Feishu
            </span>
          </div>
        )}

        {/* File attachments for user messages */}
        {isUser && files.length > 0 && (
          <FileAttachmentDisplay files={files} />
        )}

        {/* Tool calls for assistant messages — compact collapsible group */}
        {!isUser && pairedTools.length > 0 && (
          <ToolActionsGroup
            tools={pairedTools.map((tool, i) => ({
              id: `hist-${i}`,
              name: tool.name,
              input: tool.input,
              result: tool.result,
              isError: tool.isError,
            }))}
          />
        )}

        {!isUser && (
          <ArtifactReferencePreview
            text={displayText}
            tools={pairedTools.map((tool) => ({
              name: tool.name,
              result: tool.result,
              isError: tool.isError,
            }))}
          />
        )}

        {/* Text content */}
        {displayText && (
          isUser ? (
            <div className="relative">
              <div
                ref={contentRef}
                className="text-sm whitespace-pre-wrap break-words transition-[max-height] duration-300 ease-in-out overflow-hidden"
                style={
                  isOverflowing && !isExpanded
                    ? { maxHeight: `${COLLAPSE_HEIGHT}px` }
                    : undefined
                }
              >
                {displayText}
              </div>
              {isOverflowing && !isExpanded && (
                <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-secondary to-transparent pointer-events-none" />
              )}
              {isOverflowing && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => setIsExpanded(!isExpanded)}
                      className="cursor-pointer relative z-10 flex items-center gap-1 mt-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {isExpanded ? (
                        <>
                          <HugeiconsIcon icon={ArrowUp01} className="h-3 w-3" />
                          <span>收起</span>
                        </>
                      ) : (
                        <>
                          <HugeiconsIcon icon={ArrowDown01} className="h-3 w-3" />
                          <span>展开</span>
                        </>
                      )}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>{isExpanded ? t('tooltip.collapseMessage') : t('tooltip.expandMessage')}</TooltipContent>
                </Tooltip>
              )}
            </div>
          ) : (() => {
            // Try batch-plan first (Image Agent batch mode)
            const batchPlanResult = parseBatchPlan(displayText);
            if (batchPlanResult) {
              return (
                <>
                  {batchPlanResult.beforeText && <MessageResponse>{batchPlanResult.beforeText}</MessageResponse>}
                  <BatchPlanInlinePreview plan={batchPlanResult.plan} messageId={message.id} />
                  {batchPlanResult.afterText && <MessageResponse>{batchPlanResult.afterText}</MessageResponse>}
                </>
              );
            }

            const extensionPlanResult = parseExtensionPlan(displayText);
            if (extensionPlanResult) {
              return (
                <>
                  {extensionPlanResult.beforeText && <MessageResponse>{extensionPlanResult.beforeText}</MessageResponse>}
                  <ExtensionPlanCard plan={extensionPlanResult.plan} />
                  {extensionPlanResult.afterText && <MessageResponse>{extensionPlanResult.afterText}</MessageResponse>}
                </>
              );
            }

            // Try image-gen-result first (new direct-call format)
            const genResult = parseImageGenResult(displayText);
            if (genResult) {
              const { result } = genResult;
              if (result.status === 'generating') {
                return (
                  <>
                    {genResult.beforeText && <MessageResponse>{genResult.beforeText}</MessageResponse>}
                    <div className="flex items-center gap-2 py-3">
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                      <span className="text-sm text-muted-foreground">Generating image...</span>
                    </div>
                    {genResult.afterText && <MessageResponse>{genResult.afterText}</MessageResponse>}
                  </>
                );
              }
              if (result.status === 'error') {
                return (
                  <>
                    {genResult.beforeText && <MessageResponse>{genResult.beforeText}</MessageResponse>}
                    <div className="rounded-md border border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/30 p-3">
                      <p className="text-sm text-red-600 dark:text-red-400">{result.error || 'Image generation failed'}</p>
                    </div>
                    {genResult.afterText && <MessageResponse>{genResult.afterText}</MessageResponse>}
                  </>
                );
              }
              if (result.status === 'completed' && result.images && result.images.length > 0) {
                return (
                  <>
                    {genResult.beforeText && <MessageResponse>{genResult.beforeText}</MessageResponse>}
                    <ImageGenCard
                      images={result.images.map(img => ({
                        data: img.data || '',
                        mimeType: img.mimeType,
                        localPath: img.localPath,
                      }))}
                      prompt={result.prompt}
                      aspectRatio={result.aspectRatio}
                      imageSize={result.resolution}
                      model={result.model}
                    />
                    {genResult.afterText && <MessageResponse>{genResult.afterText}</MessageResponse>}
                  </>
                );
              }
            }

            // Legacy: image-gen-request (model-dependent format, for old messages)
            const parsed = parseImageGenRequest(displayText);
            if (parsed) {
              const refs = buildReferenceImages(
                message.id,
                parsed.request.useLastGenerated || false,
                parsed.request.referenceImages,
              );
              return (
                <>
                  {parsed.beforeText && <MessageResponse>{parsed.beforeText}</MessageResponse>}
                  <ImageGenConfirmation
                    messageId={message.id}
                    initialPrompt={parsed.request.prompt}
                    initialAspectRatio={parsed.request.aspectRatio}
                    initialResolution={parsed.request.resolution}
                    referenceImages={refs.length > 0 ? refs : undefined}
                  />
                  {parsed.afterText && <MessageResponse>{parsed.afterText}</MessageResponse>}
                </>
              );
            }
            const stripped = displayText
              .replace(/```image-gen-request[\s\S]*?```/g, '')
              .replace(/```image-gen-result[\s\S]*?```/g, '')
              .replace(/```batch-plan[\s\S]*?```/g, '')
              .replace(/```lumos-extension-plan[\s\S]*?```/g, '')
              .trim();
            return stripped ? <MessageResponse>{stripped}</MessageResponse> : null;
          })()
        )}
      </MessageContent>

      {/* Footer with copy, timestamp and token usage */}
      <div className={`flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 ${isUser ? 'justify-end' : ''}`}>
        {!isUser && <span className="text-xs text-muted-foreground/50">{timestamp}</span>}
        {!isUser && tokenUsage && <TokenUsageDisplay usage={tokenUsage} />}
        {displayText && <CopyButton text={displayText} />}
      </div>
    </AIMessage>
  );
}
