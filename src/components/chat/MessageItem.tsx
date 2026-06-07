'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import type { Message, TokenUsage, FileAttachment } from '@/types';
import {
  Message as AIMessage,
  MessageContent,
  MessageResponse,
} from '@/components/ai-elements/message';
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from '@/components/ai-elements/reasoning';
import { ToolActionsGroup } from '@/components/ai-elements/tool-actions-group';
import { HugeiconsIcon } from "@hugeicons/react";
import { Copy, Tick, ArrowDown01, ArrowUp01 } from "@hugeicons/core-free-icons";
import { FileAttachmentDisplay } from './FileAttachmentDisplay';
import { useTranslation } from '@/hooks/useTranslation';
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ImageGenCard } from './ImageGenCard';
import { ArtifactReferencePreview } from './ArtifactReferencePreview';
import { parseDBDate } from '@/lib/utils';
import { ExtensionPlanCard } from '@/components/extensions/ExtensionPlanCard';
import { filterSystemPrompt } from '@/lib/filter-system-prompt';
import { DeepSearchSourcesCard, extractDeepSearchSources } from './DeepSearchSourcesCard';
import { DeepSearchLoginCard, extractDeepSearchError } from './DeepSearchLoginCard';
import { unwrapToolResult } from '@/lib/tool-result-parser';
import { stripLeakedToolTraceText } from '@/lib/chat/tool-trace-sanitizer';

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

function parseToolBlocks(content: string): { text: string; tools: ToolBlock[]; reasoning: string[] } {
  const tools: ToolBlock[] = [];
  const reasoning: string[] = [];
  let text = '';

  // Try to parse as JSON array (new format from chat API)
  if (content.startsWith('[')) {
    try {
      const blocks = JSON.parse(content) as Array<{
        type: string;
        text?: string;
        summary?: string;
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
        } else if (block.type === 'reasoning' && typeof block.summary === 'string' && block.summary.trim()) {
          reasoning.push(block.summary.trim());
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
      
      return { text: text.trim(), tools, reasoning };
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

  return { text: text.trim(), tools, reasoning };
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

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s % 60)}s`;
}

export function MessageItem({ message }: MessageItemProps) {
  const { t } = useTranslation();
  const isUser = message.role === 'user';
  const shouldHideImageNotice = isUser && message.content.startsWith('[__IMAGE_GEN_NOTICE__');

  // Collapse/expand state for long user messages (hooks must be called unconditionally)
  const [isExpanded, setIsExpanded] = useState(false);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  // 过滤系统提示（用于任务管理通知）
  const filteredContent = isUser ? filterSystemPrompt(message.content) : message.content;
  const { text, tools, reasoning } = parseToolBlocks(filteredContent);
  const pairedTools = pairTools(tools);
  const reasoningContent = reasoning.map((summary) => `- ${summary}`).join('\n');

  // Parse file attachments from user messages
  const { files, source, text: textWithoutMeta } = isUser
    ? parseMessageMeta(text)
    : { files: [], source: undefined, text };

  const displayText = isUser ? textWithoutMeta : stripLeakedToolTraceText(text);

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
              飞书
            </span>
          </div>
        )}
        {isUser && source === 'wechat' && (
          <div className="mb-1">
            <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 border border-emerald-200">
              微信
            </span>
          </div>
        )}

        {/* File attachments for user messages */}
        {isUser && files.length > 0 && (
          <FileAttachmentDisplay files={files} />
        )}

        {/* Tool calls for assistant messages — compact collapsible group */}
        {!isUser && reasoning.length > 0 && (
          <Reasoning className="mb-3" defaultOpen={false}>
            <ReasoningTrigger />
            <ReasoningContent>{reasoningContent}</ReasoningContent>
          </Reasoning>
        )}

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

        {!isUser && (() => {
          try {
            const ds = extractDeepSearchSources(pairedTools);
            if (ds) return <DeepSearchSourcesCard sources={ds.sources} query={ds.query} runId={ds.runId} archivePrompt={ds.archivePrompt} />;
            const dsError = extractDeepSearchError(pairedTools);
            return dsError ? <DeepSearchLoginCard info={dsError} /> : null;
          } catch {
            return null;
          }
        })()}

        {/* Image gen cards from generate_image tool results */}
        {!isUser && pairedTools.map((tool, i) => {
          const n = tool.name.toLowerCase();
          if (tool.isError || !tool.result || !n.includes('generate_image')) return null;
          try {
            const r = unwrapToolResult(tool.result);
            if (!r || !Array.isArray(r.images) || r.images.length === 0) return null;
            const images = (r.images as Array<Record<string, unknown>>).map(img => ({
              data: '',
              mimeType: String(img.mime_type || 'image/png'),
              directUrl: img.url ? String(img.url) : undefined,
              localPath: img.url ? undefined : String(img.path || ''),
            }));
            const inp = tool.input as Record<string, unknown> | undefined;
            return (
              <ImageGenCard
                key={`img-gen-${i}`}
                images={images}
                prompt={String(inp?.prompt || r.prompt || '')}
                aspectRatio={typeof inp?.aspect_ratio === 'string' ? inp.aspect_ratio : undefined}
                imageSize={typeof inp?.image_size === 'string' ? inp.image_size : undefined}
                model={typeof r.model === 'string' ? r.model : undefined}
                provider={typeof r.provider === 'string' ? r.provider : undefined}
              />
            );
          } catch { return null; }
        })}

        {!isUser && (
          <ArtifactReferencePreview
            text={displayText}
            tools={pairedTools
              .filter((tool) => !tool.name.toLowerCase().includes('generate_image'))
              .map((tool) => ({
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

            // 老「图片助手」暗号(image-gen-result / image-gen-request)的特殊渲染已拆。
            // 新工具 generate_image 的出图走上面 tool_result 分支(ImageGenCard);老历史消息里的暗号块由下面 stripped 去掉、只留文字。
            const stripped = displayText
              .replace(/```image-gen-request[\s\S]*?```/g, '')
              .replace(/```image-gen-result[\s\S]*?```/g, '')
              .replace(/```batch-plan[\s\S]*?```/g, '')
              .replace(/```lumos-extension-plan[\s\S]*?```/g, '')
              .replace(/```lumos-team-plan[\s\S]*?```/g, '')
              .trim();
            return stripped ? <MessageResponse>{stripped}</MessageResponse> : null;
          })()
        )}
      </MessageContent>

      {/* Footer with copy, timestamp and token usage */}
      <div className={`flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 ${isUser ? 'justify-end' : ''}`}>
        {!isUser && <span className="text-xs text-muted-foreground/50">{timestamp}</span>}
        {!isUser && message.elapsed_ms != null && (
          <span className="text-xs text-muted-foreground/50">{formatElapsed(message.elapsed_ms)}</span>
        )}
        {!isUser && tokenUsage && <TokenUsageDisplay usage={tokenUsage} />}
        {displayText && <CopyButton text={displayText} />}
      </div>
    </AIMessage>
  );
}
