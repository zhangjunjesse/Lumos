"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Search, Delete } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { LibraryChatPanel } from "@/components/knowledge/LibraryChatPanel";
import { LibraryImportPanel } from "@/components/knowledge/library-import-panel";
import { BottomChatPanel } from "@/components/layout/BottomChatPanel";
import {
  getDefaultCollection,
  getDirectoryImportJob,
  importDirectory,
  listDirectoryImportJobs,
  removeDirectoryKnowledge,
  retryDirectoryImportJob,
  type KnowledgeIngestJob,
  type KnowledgeIngestJobItem,
} from "@/lib/knowledge/client";
import type { FileTreeNode } from "@/types";
import { LibraryContentPreview } from "@/components/knowledge/library-content-preview";

// 类型定义
type PathItem = {
  id: string;
  title: string;
};

type Tag = {
  label: string;
  type: 'custom' | 'ai' | 'system';
  category?: 'domain' | 'tech' | 'doctype' | 'project' | 'custom';
  color?: string;
};

type ProcessingStatus =
  | 'pending'
  | 'parsing'
  | 'chunking'
  | 'indexing'
  | 'embedding'
  | 'summarizing'
  | 'ready'
  | 'partial'
  | 'reference_only'
  | 'failed';

type ViewMode = "all" | "recent" | "ready" | "attention";
type TypeFilter = "all" | "documents" | "conversations" | "audio" | "video" | "web";
type SortMode = "updated_desc" | "updated_asc" | "title_asc" | "title_desc";

type LibraryItem = {
  id: string;
  type: string;
  title: string;
  preview: string;
  summary: string;
  keyPoints: string[];
  path: string;
  displayPath?: string;
  updatedAt?: string;
  timeLabel: string;
  date: string;
  fullDate: string;
  tags: Tag[];
  isDirectory?: boolean;
  children?: LibraryItem[];
  sourceType?: string;
  sourceKey?: string;
  isVirtual?: boolean;
  processingStatus?: ProcessingStatus;
  processingError?: string;
  processingDetail?: string;
  chunkCount?: number;
  ingestJobId?: string;
};

type KbItem = {
  id: string;
  title: string;
  source_type: string;
  source_path: string;
  source_key?: string;
  content: string;
  tags: string;
  summary?: string;
  key_points?: string;
  created_at: string;
  updated_at: string;
  processing_status?: ProcessingStatus;
  processing_detail?: string;
  processing_error?: string;
  chunk_count?: number;
};

type KbItemDetail = KbItem & {
  full_content?: string;
};

type TagCatalogItem = {
  id: string;
  name: string;
  category: 'domain' | 'tech' | 'doctype' | 'project' | 'custom';
  color: string;
  usage_count: number;
};

const PROCESSING_META: Record<ProcessingStatus, { label: string; className: string; brief: string }> = {
  pending: {
    label: '待处理',
    className: 'bg-slate-100 text-slate-600',
    brief: '资料已入库，等待进入处理管线',
  },
  parsing: {
    label: '解析中',
    className: 'bg-sky-100 text-sky-700',
    brief: '正在抽取可检索文本',
  },
  chunking: {
    label: '切片中',
    className: 'bg-blue-100 text-blue-700',
    brief: '正在将内容切分为检索片段',
  },
  indexing: {
    label: '建索引',
    className: 'bg-indigo-100 text-indigo-700',
    brief: '正在构建关键词索引',
  },
  embedding: {
    label: '向量化',
    className: 'bg-violet-100 text-violet-700',
    brief: '正在生成语义向量',
  },
  summarizing: {
    label: '总结中',
    className: 'bg-amber-100 text-amber-700',
    brief: '正在生成摘要与要点',
  },
  ready: {
    label: '可用',
    className: 'bg-emerald-100 text-emerald-700',
    brief: '可参与语义检索与对话引用',
  },
  partial: {
    label: '部分可用',
    className: 'bg-yellow-100 text-yellow-700',
    brief: '部分索引成功，建议稍后重试增强处理',
  },
  reference_only: {
    label: '引用型',
    className: 'bg-orange-100 text-orange-700',
    brief: '仅登记来源路径，回答时按需读取原文',
  },
  failed: {
    label: '处理失败',
    className: 'bg-rose-100 text-rose-700',
    brief: '处理失败，建议检查格式或重新导入',
  },
};

const VIEW_MODE_OPTIONS: Array<{ key: ViewMode; label: string }> = [
  { key: "all", label: "全部资料" },
  { key: "recent", label: "最近 7 天" },
  { key: "ready", label: "可用于对话" },
  { key: "attention", label: "需要处理" },
];

const TYPE_FILTER_OPTIONS: Array<{ key: TypeFilter; label: string }> = [
  { key: "all", label: "全部" },
  { key: "documents", label: "文档" },
  { key: "conversations", label: "对话" },
  { key: "audio", label: "音频" },
  { key: "video", label: "视频" },
  { key: "web", label: "网页" },
];

const SORT_MODE_OPTIONS: Array<{ key: SortMode; label: string }> = [
  { key: "updated_desc", label: "最近更新" },
  { key: "updated_asc", label: "最早更新" },
  { key: "title_asc", label: "标题正序" },
  { key: "title_desc", label: "标题倒序" },
];

const TAG_CATEGORY_LABEL: Record<TagCatalogItem["category"], string> = {
  domain: "领域",
  tech: "技术",
  doctype: "文档类型",
  project: "项目",
  custom: "自定义",
};

const TAG_CATEGORY_ORDER: TagCatalogItem["category"][] = [
  "domain",
  "tech",
  "doctype",
  "project",
  "custom",
];

const TOP_ACTION_BUTTON_CLASS =
  "h-9 shrink-0 rounded-lg border border-border bg-background px-3 text-sm font-medium text-foreground transition-colors hover:bg-accent";

const FEISHU_SYSTEM_TAG: Tag = {
  label: "飞书",
  type: "system",
};

function getTagStyle(tag: Tag, options?: { selected?: boolean; compact?: boolean }) {
  const selected = options?.selected ?? false;
  const compact = options?.compact ?? false;
  const spacing = compact ? "px-2.5 py-1 text-[11px]" : "px-3 py-1.5 text-xs";
  const ring = selected ? " ring-2 ring-primary/70 ring-offset-2 ring-offset-background" : "";

  if (tag.type === "custom") {
    const colors: Record<string, string> = {
      red: "border-red-200 bg-red-50 text-red-700",
      orange: "border-orange-200 bg-orange-50 text-orange-700",
      yellow: "border-yellow-200 bg-yellow-50 text-yellow-700",
      green: "border-green-200 bg-green-50 text-green-700",
      blue: "border-blue-200 bg-blue-50 text-blue-700",
      purple: "border-purple-200 bg-purple-50 text-purple-700",
    };
    return `border ${spacing}${ring} ${colors[tag.color || "blue"] || colors.blue}`;
  }

  if (tag.type === "ai") {
    return `border border-sky-200 bg-sky-50 text-sky-700 ${spacing}${ring}`;
  }

  return `border border-slate-200 bg-slate-50 text-slate-700 ${spacing}${ring}`;
}

// 文件类型 Logo 组件
const FileTypeLogo = ({ type }: { type: string }) => {
  const logos: Record<string, React.ReactElement> = {
    "Word 文档": (
      <div className="w-8 h-8 rounded flex items-center justify-center bg-[#2B579A]">
        <span className="text-white text-xs font-bold">W</span>
      </div>
    ),
    "PDF 文档": (
      <div className="w-8 h-8 rounded flex items-center justify-center bg-[#DC3C2E]">
        <span className="text-white text-[10px] font-bold">PDF</span>
      </div>
    ),
    "PowerPoint": (
      <div className="w-8 h-8 rounded flex items-center justify-center bg-[#D24726]">
        <span className="text-white text-xs font-bold">P</span>
      </div>
    ),
    "Excel 表格": (
      <div className="w-8 h-8 rounded flex items-center justify-center bg-[#217346]">
        <span className="text-white text-xs font-bold">X</span>
      </div>
    ),
    "Markdown": (
      <div className="w-8 h-8 rounded flex items-center justify-center bg-gray-700">
        <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor">
          <path d="M22.27 19.385H1.73A1.73 1.73 0 010 17.655V6.345a1.73 1.73 0 011.73-1.73h20.54A1.73 1.73 0 0124 6.345v11.308a1.73 1.73 0 01-1.73 1.731zM5.769 15.923v-4.5l2.308 2.885 2.307-2.885v4.5h2.308V8.078h-2.308l-2.307 2.885-2.308-2.885H3.46v7.847zM21.232 12h-2.309V8.077h-2.307V12h-2.308l3.461 4.039z"/>
        </svg>
      </div>
    ),
    "文本": (
      <div className="w-8 h-8 rounded flex items-center justify-center bg-gray-600">
        <span className="text-white text-[10px] font-bold">TXT</span>
      </div>
    ),
    "文件": (
      <div className="w-8 h-8 rounded flex items-center justify-center bg-gray-500">
        <span className="text-white text-[10px] font-bold">FILE</span>
      </div>
    ),
    "文件目录": (
      <div className="w-8 h-8 rounded flex items-center justify-center bg-amber-500">
        <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
        </svg>
      </div>
    ),
    "联网搜索": (
      <div className="w-8 h-8 rounded flex items-center justify-center bg-sky-500">
        <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
        </svg>
      </div>
    ),
    "MP3 音频": (
      <div className="w-8 h-8 rounded flex items-center justify-center bg-[#9333EA]">
        <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
        </svg>
      </div>
    ),
    "iPhone 录音": (
      <div className="w-8 h-8 rounded flex items-center justify-center bg-gradient-to-br from-gray-700 to-gray-900">
        <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
        </svg>
      </div>
    ),
    "WAV 音频": (
      <div className="w-8 h-8 rounded flex items-center justify-center bg-[#8B5CF6]">
        <span className="text-white text-[10px] font-bold">WAV</span>
      </div>
    ),
    "AAC 音频": (
      <div className="w-8 h-8 rounded flex items-center justify-center bg-[#A855F7]">
        <span className="text-white text-[10px] font-bold">AAC</span>
      </div>
    ),
    "FLAC 音频": (
      <div className="w-8 h-8 rounded flex items-center justify-center bg-[#7C3AED]">
        <span className="text-white text-[9px] font-bold">FLAC</span>
      </div>
    ),
    "MP4 视频": (
      <div className="w-8 h-8 rounded flex items-center justify-center bg-[#F97316]">
        <span className="text-white text-[10px] font-bold">MP4</span>
      </div>
    ),
    "MOV 视频": (
      <div className="w-8 h-8 rounded flex items-center justify-center bg-[#EA580C]">
        <span className="text-white text-[10px] font-bold">MOV</span>
      </div>
    ),
    "AVI 视频": (
      <div className="w-8 h-8 rounded flex items-center justify-center bg-[#FB923C]">
        <span className="text-white text-[10px] font-bold">AVI</span>
      </div>
    ),
    "MKV 视频": (
      <div className="w-8 h-8 rounded flex items-center justify-center bg-[#F59E0B]">
        <span className="text-white text-[10px] font-bold">MKV</span>
      </div>
    ),
    "飞书文档": (
      <div className="w-8 h-8 rounded flex items-center justify-center bg-[#00D6B9]">
        <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2L2 7v10c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-10-5zm0 2.18l8 4V17c0 4.52-3.13 8.75-8 9.92-4.87-1.17-8-5.4-8-9.92V8.18l8-4z"/>
        </svg>
      </div>
    ),
    "Google Docs": (
      <div className="w-8 h-8 rounded flex items-center justify-center bg-[#4285F4]">
        <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor">
          <path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zM6 20V4h7v5h5v11H6zm2-2h8v-2H8v2zm0-4h8v-2H8v2zm0-4h5V8H8v2z"/>
        </svg>
      </div>
    ),
    "Notion": (
      <div className="w-8 h-8 rounded flex items-center justify-center bg-black dark:bg-white">
        <span className="text-white dark:text-black text-xs font-bold">N</span>
      </div>
    ),
    "语雀文档": (
      <div className="w-8 h-8 rounded flex items-center justify-center bg-[#25B864]">
        <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z"/>
        </svg>
      </div>
    ),
    "网页": (
      <div className="w-8 h-8 rounded flex items-center justify-center bg-[#10B981]">
        <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
        </svg>
      </div>
    ),
    "AI 对话": (
      <div className="w-8 h-8 rounded flex items-center justify-center bg-gradient-to-br from-violet-500 to-fuchsia-500">
        <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
        </svg>
      </div>
    ),
  };

  return logos[type] || logos["Word 文档"];
};

function formatDateParts(timestamp?: string) {
  if (!timestamp) {
    return { date: "-", fullDate: "-" };
  }
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return { date: "-", fullDate: timestamp };
  }
  return {
    date: date.toLocaleDateString(),
    fullDate: date.toLocaleString(),
  };
}

function mapPathToType(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() || "";
  switch (ext) {
    case "docx":
      return "Word 文档";
    case "pdf":
      return "PDF 文档";
    case "ppt":
    case "pptx":
      return "PowerPoint";
    case "xls":
    case "xlsx":
    case "csv":
      return "Excel 表格";
    case "md":
    case "mdx":
      return "Markdown";
    case "mp3":
      return "MP3 音频";
    case "wav":
      return "WAV 音频";
    case "aac":
      return "AAC 音频";
    case "m4a":
      return "M4A 音频";
    case "flac":
      return "FLAC 音频";
    case "ogg":
      return "OGG 音频";
    case "opus":
      return "OPUS 音频";
    case "mp4":
      return "MP4 视频";
    case "mov":
      return "MOV 视频";
    case "avi":
      return "AVI 视频";
    case "mkv":
      return "MKV 视频";
    default:
      return "文件";
  }
}

function isFeishuDocSourceKey(sourceKey?: string): boolean {
  const key = String(sourceKey || "").trim().toLowerCase();
  return key.startsWith("feishu:") && !key.startsWith("feishu:file:");
}

function isFeishuSource(sourceType?: string, sourceKey?: string, pathLike?: string): boolean {
  if (sourceType === "feishu") return true;
  const normalizedKey = String(sourceKey || "").trim().toLowerCase();
  if (normalizedKey.startsWith("feishu:")) return true;
  const normalizedPath = normalizeFsPath(pathLike || "");
  return normalizedPath.includes("/.lumos-uploads/feishu-folders/")
    || normalizedPath.includes("/.lumos-uploads/feishu-docs/")
    || normalizedPath.includes("/.lumos-uploads/feishu-files/");
}

function stripLeadingTimestamp(value: string): string {
  return value.replace(/^\d{10,}-/, "");
}

function stripTrailingTokenSuffix(value: string): string {
  return value.replace(/-[A-Za-z0-9]{6}$/, "");
}

function stripTrailingDocModeSuffix(value: string): string {
  return value.replace(/-(ref|full)$/i, "");
}

function decodeFeishuFileName(name: string): string {
  const dotIndex = name.lastIndexOf(".");
  if (dotIndex <= 0) {
    return stripTrailingTokenSuffix(name);
  }
  const stem = name.slice(0, dotIndex);
  const ext = name.slice(dotIndex);
  return `${stripTrailingTokenSuffix(stem)}${ext}`;
}

function extractMirrorSegments(pathLike: string, marker: string): string[] {
  const normalized = normalizeFsPath(pathLike);
  const index = normalized.indexOf(marker);
  if (index < 0) return [];
  return normalized
    .slice(index + marker.length)
    .split("/")
    .filter(Boolean);
}

function decodeFeishuFolderDisplayPath(pathLike: string): string | null {
  const segments = extractMirrorSegments(pathLike, "/.lumos-uploads/feishu-folders/");
  if (segments.length === 0) return null;
  const [rootSegment, ...restSegments] = segments;
  const rootTitle = stripTrailingTokenSuffix(stripLeadingTimestamp(rootSegment)) || "未命名目录";
  const tail = restSegments.map((segment, index) => {
    const isLast = index === restSegments.length - 1;
    if (isLast && segment.includes(".")) {
      return decodeFeishuFileName(segment);
    }
    return segment;
  });
  return ["飞书云盘", rootTitle, ...tail].join(" / ");
}

function decodeFeishuDocDisplayPath(pathLike: string): string | null {
  const segments = extractMirrorSegments(pathLike, "/.lumos-uploads/feishu-docs/");
  const fileName = segments[segments.length - 1];
  if (!fileName) return null;
  const withoutTimestamp = stripLeadingTimestamp(fileName);
  const withoutExt = withoutTimestamp.replace(/\.md$/i, "");
  const title = stripTrailingDocModeSuffix(withoutExt) || "未命名文档";
  return `飞书文档 / ${title}`;
}

function decodeFeishuFileDisplayPath(pathLike: string): string | null {
  const segments = extractMirrorSegments(pathLike, "/.lumos-uploads/feishu-files/");
  const fileName = segments[segments.length - 1];
  if (!fileName) return null;
  const title = stripLeadingTimestamp(fileName) || "未命名文件";
  return `飞书文件 / ${title}`;
}

function resolveDisplayPath(pathLike: string, options?: { sourceType?: string; sourceKey?: string }): string {
  if (!pathLike) return "";
  if (!isFeishuSource(options?.sourceType, options?.sourceKey, pathLike)) {
    return pathLike;
  }
  const folderDisplayPath = decodeFeishuFolderDisplayPath(pathLike);
  if (folderDisplayPath) {
    return options?.sourceType === "feishu" || isFeishuDocSourceKey(options?.sourceKey)
      ? folderDisplayPath.replace(/\.md$/i, "")
      : folderDisplayPath;
  }
  return (
    decodeFeishuDocDisplayPath(pathLike)
    || decodeFeishuFileDisplayPath(pathLike)
    || pathLike
  );
}

function isMirroredTitle(value: string, pathLike: string): boolean {
  const title = String(value || "").trim();
  if (!title) return true;
  const baseName = basenameFsPath(pathLike);
  if (title === baseName) return true;
  return /^\d{10,}-/.test(title) || /-[A-Za-z0-9]{6}(\.[^.]+)?$/i.test(title);
}

function resolveDisplayTitle(title: string, pathLike: string, options?: { sourceType?: string; sourceKey?: string }): string {
  const fallbackTitle = title || basenameFsPath(pathLike) || "Untitled";
  if (!isFeishuSource(options?.sourceType, options?.sourceKey, pathLike)) {
    return fallbackTitle;
  }
  const displayPath = resolveDisplayPath(pathLike, options);
  const displayLeaf = displayPath.split(" / ").filter(Boolean).pop();
  if (!displayLeaf) return fallbackTitle;
  return isMirroredTitle(fallbackTitle, pathLike) ? displayLeaf : fallbackTitle;
}

function withSourceTags(tags: Tag[], options?: { isFeishu?: boolean }): Tag[] {
  if (!options?.isFeishu) return tags;
  if (tags.some((tag) => tag.label === FEISHU_SYSTEM_TAG.label)) return tags;
  return [FEISHU_SYSTEM_TAG, ...tags];
}

function mapSourceToType(item: Pick<KbItem, "source_type" | "source_path" | "source_key">): string {
  if (item.source_type === "local_dir") return "文件目录";
  if (item.source_type === "webpage") return "网页";
  if (item.source_type === "manual") return "文本";
  if (item.source_type === "feishu" || isFeishuDocSourceKey(item.source_key)) return "飞书文档";
  return mapPathToType(item.source_path || "");
}

function normalizeProcessingStatus(value?: string): ProcessingStatus {
  const known: ProcessingStatus[] = [
    'pending',
    'parsing',
    'chunking',
    'indexing',
    'embedding',
    'summarizing',
    'ready',
    'partial',
    'reference_only',
    'failed',
  ];
  return known.includes(value as ProcessingStatus) ? (value as ProcessingStatus) : 'pending';
}

function parseProcessingDetail(detailRaw?: string): Record<string, string> {
  if (!detailRaw) return {};
  try {
    const parsed = JSON.parse(detailRaw);
    if (!parsed || typeof parsed !== 'object') return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).map(([key, value]) => [key, String(value)]),
    );
  } catch {
    return {};
  }
}

function processingMeta(status?: string) {
  const normalized = normalizeProcessingStatus(status);
  return PROCESSING_META[normalized];
}

function shouldShowKnowledgeEnhancementHint(item: LibraryItem): boolean {
  const detail = parseProcessingDetail(item.processingDetail);
  return detail.summary === "skipped" && !item.summary && item.keyPoints.length === 0;
}

function isReadyStatus(status?: ProcessingStatus) {
  return ["ready", "reference_only", "partial"].includes(status || "pending");
}

function isAttentionStatus(status?: ProcessingStatus) {
  return ["failed", "pending", "parsing", "chunking", "indexing", "embedding", "summarizing"].includes(status || "pending");
}

function normalizeFsPath(value: string): string {
  return (value || "")
    .replace(/\\/g, "/")
    .replace(/\/{2,}/g, "/")
    .replace(/\/$/, "");
}

function basenameFsPath(value: string): string {
  const normalized = normalizeFsPath(value);
  if (!normalized) return "";
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] || normalized;
}

function isPathInsideDir(pathLike: string, dirPath: string): boolean {
  const path = normalizeFsPath(pathLike);
  const dir = normalizeFsPath(dirPath);
  if (!path || !dir) return false;
  return path === dir || path.startsWith(`${dir}/`);
}

function isRootIngestDirectory(item?: LibraryItem | null): boolean {
  if (!item?.isVirtual || !item.isDirectory || !item.ingestJobId) return false;
  return item.id === `ingest:${item.ingestJobId}`;
}

function canRemoveLibraryItem(item?: LibraryItem | null): boolean {
  if (!item) return false;
  if (!item.isVirtual) return true;
  return isRootIngestDirectory(item);
}

function removeDisabledReason(item?: LibraryItem | null): string {
  if (!item) return "请选择资料";
  if (isRootIngestDirectory(item)) return "移除目录（含队列任务与已入库文件）";
  if (canRemoveLibraryItem(item)) return "移除资料";
  if (item.isVirtual) return "仅支持移除目录根节点";
  return "移除资料";
}

function relativeFsPath(baseDir: string, targetPath: string): string {
  const base = normalizeFsPath(baseDir);
  const target = normalizeFsPath(targetPath);
  if (!base || !target) return target || "";
  if (target === base) return "";
  if (target.startsWith(`${base}/`)) return target.slice(base.length + 1);
  return basenameFsPath(target);
}

function mapIngestJobStatusToProcessing(status: KnowledgeIngestJob["status"]): ProcessingStatus {
  if (status === "running") return "parsing";
  if (status === "completed") return "ready";
  if (status === "failed" || status === "cancelled") return "failed";
  return "pending";
}

function mapIngestItemStatusToProcessing(status: KnowledgeIngestJobItem["status"]): ProcessingStatus {
  if (status === "running") return "parsing";
  if (status === "completed" || status === "duplicate") return "ready";
  if (status === "failed") return "failed";
  if (status === "skipped") return "partial";
  return "pending";
}

function isRecentUpdate(updatedAt?: string, days = 7) {
  if (!updatedAt) return false;
  const timestamp = Date.parse(updatedAt);
  if (!Number.isFinite(timestamp)) return false;
  return Date.now() - timestamp <= days * 24 * 60 * 60 * 1000;
}

function matchesTypeFilter(item: LibraryItem, filter: TypeFilter) {
  if (filter === "all") return true;
  if (filter === "documents") {
    return [
      "Word 文档",
      "PDF 文档",
      "PowerPoint",
      "Excel 表格",
      "Markdown",
      "飞书文档",
      "Google Docs",
      "Notion",
      "语雀文档",
      "文本",
      "文件",
      "文件目录",
    ].includes(item.type);
  }
  if (filter === "conversations") return item.type === "AI 对话";
  if (filter === "audio") {
    return ["MP3 音频", "iPhone 录音", "WAV 音频", "AAC 音频", "M4A 音频", "FLAC 音频", "OGG 音频", "OPUS 音频"].includes(item.type);
  }
  if (filter === "video") {
    return ["MP4 视频", "MOV 视频", "AVI 视频", "MKV 视频"].includes(item.type);
  }
  if (filter === "web") return item.type === "网页" || item.type === "联网搜索";
  return true;
}

function parseKeyPoints(raw: string | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry) => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .slice(0, 5);
  } catch {
    return [];
  }
}

function mapKbItemToLibrary(
  item: KbItem,
  tagMetaByName: Map<string, TagCatalogItem> = new Map(),
): LibraryItem {
  const { date, fullDate } = formatDateParts(item.updated_at || item.created_at);
  const displayPath = resolveDisplayPath(item.source_path || "", {
    sourceType: item.source_type,
    sourceKey: item.source_key,
  });
  const feishuSource = isFeishuSource(item.source_type, item.source_key, item.source_path);
  const tags: string[] = (() => {
    try {
      const parsed = JSON.parse(item.tags || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  })();

  const isDirectory = item.source_type === "local_dir";
  const statusMeta = processingMeta(item.processing_status);
  const summary = (item.summary || "").trim();
  const keyPoints = parseKeyPoints(item.key_points);
  const fallbackPreview = isDirectory
    ? statusMeta.brief
    : item.content?.trim()
      ? item.content.slice(0, 180)
      : displayPath
        ? `来源: ${displayPath}`
        : statusMeta.brief;
  const preview = summary || fallbackPreview;

  return {
    id: item.id,
    type: mapSourceToType(item),
    title: resolveDisplayTitle(item.title || "Untitled", item.source_path || "", {
      sourceType: item.source_type,
      sourceKey: item.source_key,
    }),
    preview,
    summary,
    keyPoints,
    path: item.source_path || "",
    displayPath,
    updatedAt: item.updated_at || item.created_at,
    timeLabel: "更新于",
    date,
    fullDate,
    tags: withSourceTags(
      tags.map((tag) => {
        const meta = tagMetaByName.get(tag.toLowerCase());
        const category = meta?.category || "custom";
        return {
          label: tag,
          category,
          color: meta?.color,
          type: category === "custom" ? ("custom" as const) : ("ai" as const),
        };
      }),
      { isFeishu: feishuSource },
    ),
    isDirectory,
    sourceType: item.source_type,
    sourceKey: item.source_key,
    processingStatus: normalizeProcessingStatus(item.processing_status),
    processingError: item.processing_error || "",
    processingDetail: item.processing_detail || "",
    chunkCount: Number(item.chunk_count || 0),
  };
}

function mapFileNodeToLibrary(node: FileTreeNode): LibraryItem {
  const isDirectory = node.type === "directory";
  const { date, fullDate } = formatDateParts();
  return {
    id: `${isDirectory ? "dir" : "file"}:${node.path}`,
    type: isDirectory ? "文件目录" : mapPathToType(node.path),
    title: node.name,
    preview: isDirectory ? "文件目录" : "未入库文件",
    summary: "",
    keyPoints: [],
    path: node.path,
    displayPath: node.path,
    timeLabel: "更新于",
    date,
    fullDate,
    tags: [],
    isDirectory,
    sourceType: isDirectory ? "local_dir" : "local_file",
    isVirtual: true,
    processingStatus: "pending",
    processingError: "",
    processingDetail: "",
    chunkCount: 0,
  };
}

function mapIngestJobToFolderItem(job: KnowledgeIngestJob): LibraryItem {
  const { date, fullDate } = formatDateParts(job.updated_at || job.created_at);
  const feishuSource = isFeishuSource(undefined, undefined, job.source_dir);
  const displayPath = resolveDisplayPath(job.source_dir);
  const total = Math.max(0, Number(job.total_files || 0));
  const processed = Math.max(0, Number(job.processed_files || 0));
  const status = mapIngestJobStatusToProcessing(job.status);
  const isFileJob = job.source_type === "file";
  const isReprocess = Number(job.force_reprocess || 0) === 1;
  const progress = total > 0 ? `${processed}/${total}` : `${processed}`;
  const actionLabel = isReprocess ? "重处理" : (isFileJob ? "文件入库" : "入库");
  const preview = job.status === "completed"
    ? `${actionLabel}完成，已处理 ${progress}`
    : job.status === "failed"
      ? `${actionLabel}失败，已处理 ${progress}`
      : job.status === "cancelled"
        ? `任务已取消，已处理 ${progress}`
        : `后台${actionLabel}中，已处理 ${progress}`;

  return {
    id: `ingest:${job.id}`,
    ingestJobId: job.id,
    type: isFileJob
      ? mapSourceToType({
          source_type: decodeFeishuDocDisplayPath(job.source_dir) ? "feishu" : "local_file",
          source_path: job.source_dir,
          source_key: "",
        })
      : "文件目录",
    title: resolveDisplayTitle(
      basenameFsPath(job.source_dir) || (isFileJob ? "未命名文件" : "未命名目录"),
      job.source_dir,
    ),
    preview,
    summary: "",
    keyPoints: [],
    path: job.source_dir,
    displayPath,
    updatedAt: job.updated_at || job.created_at,
    timeLabel: "更新于",
    date,
    fullDate,
    tags: withSourceTags([], { isFeishu: feishuSource }),
    isDirectory: !isFileJob,
    sourceType: isFileJob ? "local_file" : "local_dir",
    isVirtual: true,
    processingStatus: status,
    processingError: job.error || "",
    processingDetail: JSON.stringify({ mode: "ingest_queue", status: job.status, progress, source_type: isFileJob ? "file" : "directory" }),
    chunkCount: 0,
  };
}

function buildIngestJobChildren(
  job: KnowledgeIngestJob,
  jobItems: KnowledgeIngestJobItem[],
  kbItems: LibraryItem[],
): LibraryItem[] {
  type TreeNode = {
    item: LibraryItem;
    children: Map<string, TreeNode>;
  };

  const byId = new Map<string, LibraryItem>();
  const byPath = new Map<string, LibraryItem>();
  kbItems.forEach((item) => {
    byId.set(item.id, item);
    const path = normalizeFsPath(item.path);
    if (path) byPath.set(path, item);
  });

  const root = new Map<string, TreeNode>();
  const sourceRoot = normalizeFsPath(job.source_dir);
  const feishuJob = isFeishuSource(undefined, undefined, job.source_dir);

  const ensureDir = (parent: Map<string, TreeNode>, segment: string, absPath: string, relPath: string): TreeNode => {
    const existing = parent.get(segment);
    if (existing) return existing;
    const dirItem: LibraryItem = {
      id: `ingest:${job.id}:dir:${relPath}`,
      ingestJobId: job.id,
      type: "文件目录",
      title: segment,
      preview: "文件夹",
      summary: "",
      keyPoints: [],
      path: absPath,
      displayPath: resolveDisplayPath(absPath),
      updatedAt: job.updated_at || job.created_at,
      timeLabel: "更新于",
      date: formatDateParts(job.updated_at || job.created_at).date,
      fullDate: formatDateParts(job.updated_at || job.created_at).fullDate,
      tags: withSourceTags([], { isFeishu: feishuJob }),
      isDirectory: true,
      sourceType: "local_dir",
      isVirtual: true,
      processingStatus: "pending",
      processingError: "",
      processingDetail: "",
      chunkCount: 0,
    };
    const node = { item: dirItem, children: new Map<string, TreeNode>() };
    parent.set(segment, node);
    return node;
  };

  const sorted = [...jobItems].sort((a, b) => {
    const pa = normalizeFsPath(a.file_path);
    const pb = normalizeFsPath(b.file_path);
    return pa.localeCompare(pb, "zh-Hans-CN", { sensitivity: "base" });
  });

  for (const queued of sorted) {
    const normalizedFile = normalizeFsPath(queued.file_path);
    const rel = relativeFsPath(sourceRoot, normalizedFile);
    if (!rel) continue;
    const segments = rel.split("/").filter(Boolean);
    if (segments.length === 0) continue;

    let parent = root;
    let relAcc = "";
    for (let i = 0; i < segments.length - 1; i += 1) {
      const segment = segments[i];
      relAcc = relAcc ? `${relAcc}/${segment}` : segment;
      const absDir = sourceRoot ? `${sourceRoot}/${relAcc}` : relAcc;
      const node = ensureDir(parent, segment, absDir, relAcc);
      parent = node.children;
    }

    const fileName = segments[segments.length - 1];
    const imported = (queued.item_id && byId.get(queued.item_id)) || byPath.get(normalizedFile);
    const feishuItem = isFeishuSource(imported?.sourceType, queued.source_key, normalizedFile);
    const fallbackStatus = mapIngestItemStatusToProcessing(queued.status);
    const fallbackPreview = fallbackStatus === "ready"
      ? "已入库"
      : fallbackStatus === "failed"
        ? (queued.error || queued.parse_error || "处理失败")
        : fallbackStatus === "partial"
          ? "处理跳过"
          : "等待后台处理";
    const fileItem: LibraryItem = imported
      ? { ...imported, ingestJobId: job.id }
      : {
          id: `ingest:${job.id}:file:${queued.id}`,
          ingestJobId: job.id,
          type: mapSourceToType({
            source_type: isFeishuDocSourceKey(queued.source_key) ? "feishu" : "local_file",
            source_path: queued.file_path,
            source_key: queued.source_key,
          }),
          title: resolveDisplayTitle(fileName, queued.file_path, {
            sourceKey: queued.source_key,
          }),
          preview: fallbackPreview,
          summary: "",
          keyPoints: [],
          path: queued.file_path,
          displayPath: resolveDisplayPath(queued.file_path, {
            sourceKey: queued.source_key,
          }),
          updatedAt: queued.updated_at || queued.created_at,
          timeLabel: "更新于",
          date: formatDateParts(queued.updated_at || queued.created_at).date,
          fullDate: formatDateParts(queued.updated_at || queued.created_at).fullDate,
          tags: withSourceTags([], { isFeishu: feishuItem }),
          isDirectory: false,
          sourceType: "local_file",
          sourceKey: queued.source_key,
          isVirtual: true,
          processingStatus: fallbackStatus,
          processingError: queued.error || queued.parse_error || "",
          processingDetail: JSON.stringify({ mode: queued.mode, queue_status: queued.status }),
          chunkCount: 0,
        };

    parent.set(fileName, { item: fileItem, children: new Map<string, TreeNode>() });
  }

  const toArray = (nodeMap: Map<string, TreeNode>): LibraryItem[] => {
    const nodes = Array.from(nodeMap.values()).map((node) => {
      const children = toArray(node.children);
      const isDir = Boolean(node.item.isDirectory);
      if (!isDir) return node.item;

      const childStatuses = children.map((entry) => entry.processingStatus || "pending");
      const nextStatus: ProcessingStatus = childStatuses.some((s) => s === "failed")
        ? "failed"
        : childStatuses.some((s) => s === "pending" || s === "parsing" || s === "chunking" || s === "indexing" || s === "embedding" || s === "summarizing")
          ? "pending"
          : childStatuses.length > 0
            ? "ready"
            : "pending";
      return {
        ...node.item,
        preview: children.length > 0 ? `包含 ${children.length} 项` : "空文件夹",
        processingStatus: nextStatus,
        children,
      };
    });
    nodes.sort((a, b) => {
      const aDir = a.isDirectory ? 1 : 0;
      const bDir = b.isDirectory ? 1 : 0;
      if (aDir !== bDir) return bDir - aDir;
      return a.title.localeCompare(b.title, "zh-Hans-CN", { sensitivity: "base" });
    });
    return nodes;
  };

  return toArray(root);
}

function updateItemChildren(items: LibraryItem[], targetId: string, children: LibraryItem[]): LibraryItem[] {
  return items.map((item) => {
    if (item.id === targetId) {
      return { ...item, children };
    }
    if (item.children) {
      return { ...item, children: updateItemChildren(item.children, targetId, children) };
    }
    return item;
  });
}

function resolveItemsByPath(rootItems: LibraryItem[], path: PathItem[]): LibraryItem[] | null {
  if (path.length === 0) return rootItems;
  let nextItems = rootItems;
  for (const pathItem of path) {
    const found = nextItems.find((entry) => entry.id === pathItem.id);
    if (!found?.children) return null;
    nextItems = found.children;
  }
  return nextItems;
}

function patchItemInTree(
  items: LibraryItem[],
  targetId: string,
  patcher: (item: LibraryItem) => LibraryItem,
): LibraryItem[] {
  return items.map((item) => {
    if (item.id === targetId) {
      return patcher(item);
    }
    if (item.children?.length) {
      return {
        ...item,
        children: patchItemInTree(item.children, targetId, patcher),
      };
    }
    return item;
  });
}

export default function LibraryDemoPage() {
  const router = useRouter();
  const [filter, setFilter] = useState<TypeFilter>("all");
  const [viewMode, setViewMode] = useState<ViewMode>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [tagFilterMode, setTagFilterMode] = useState<"or" | "and">("or");
  const [showTagSelector, setShowTagSelector] = useState(false);
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("updated_desc");

  const [collectionId, setCollectionId] = useState<string | null>(null);
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [allKbItems, setAllKbItems] = useState<LibraryItem[]>([]);
  const [ingestJobs, setIngestJobs] = useState<KnowledgeIngestJob[]>([]);
  const [tagCatalog, setTagCatalog] = useState<TagCatalogItem[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [itemsError, setItemsError] = useState<string | null>(null);

  // 收藏状态
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [reindexingId, setReindexingId] = useState<string | null>(null);
  const [retryingDirectoryId, setRetryingDirectoryId] = useState<string | null>(null);

  // 详情页状态
  const [selectedItem, setSelectedItem] = useState<LibraryItem | null>(null);
  const [selectedItemFullContent, setSelectedItemFullContent] = useState("");
  const [detailContentLoading, setDetailContentLoading] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [editFeedback, setEditFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // 目录导航状态
  const [currentPath, setCurrentPath] = useState<PathItem[]>([]); // 当前路径（面包屑）
  const [currentItems, setCurrentItems] = useState<LibraryItem[]>([]); // 当前显示的项目列表

  const loadItems = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) {
      setItemsLoading(true);
    }
    setItemsError(null);
    try {
      const collection = await getDefaultCollection();
      setCollectionId(collection.id);
      const [itemRes, tagRes, jobs, collectionsRes] = await Promise.all([
        fetch(`/api/knowledge/items?collection_id=${collection.id}`),
        fetch('/api/knowledge/tags'),
        listDirectoryImportJobs({ collectionId: collection.id, limit: 200 }),
        fetch('/api/knowledge/collections'),
      ]);
      const [itemData, tagData] = await Promise.all([itemRes.json(), tagRes.json()]);
      if (!itemRes.ok) {
        throw new Error(itemData?.error || "加载资料失败");
      }

      const catalog = (Array.isArray(tagData) ? tagData : []) as TagCatalogItem[];
      setTagCatalog(catalog);
      setIngestJobs(Array.isArray(jobs) ? jobs : []);
      const tagMetaByName = new Map<string, TagCatalogItem>(
        catalog.map((tag) => [String(tag.name || '').trim().toLowerCase(), tag]),
      );
      const mapped = (Array.isArray(itemData) ? itemData : []).map((item) =>
        mapKbItemToLibrary(item as KbItem, tagMetaByName),
      );
      setAllKbItems(mapped);

      const latestJobsByDir = new Map<string, KnowledgeIngestJob>();
      for (const job of Array.isArray(jobs) ? jobs : []) {
        if (job.status === "cancelled") continue;
        if (job.source_type === "file" && job.status !== "pending" && job.status !== "running") {
          continue;
        }
        const key = normalizeFsPath(job.source_dir);
        if (!key || latestJobsByDir.has(key)) continue;
        latestJobsByDir.set(key, job);
      }
      const folderCards = Array.from(latestJobsByDir.values()).map((job) => mapIngestJobToFolderItem(job));
      const ingestDirs = folderCards.filter((folder) => folder.isDirectory).map((folder) => folder.path).filter(Boolean);
      const rootFiles = mapped.filter((item) => !ingestDirs.some((dir) => isPathInsideDir(item.path, dir)));
      const rootItems: LibraryItem[] = [...folderCards, ...rootFiles];

      // Inject "联网搜索资料" as a pinned virtual directory if the collection exists and has items
      if (collectionsRes.ok) {
        const allCollections = await collectionsRes.json() as Array<{ id: string; name: string }>;
        const dsCol = (Array.isArray(allCollections) ? allCollections : []).find(c => c.name === '联网搜索资料');
        if (dsCol) {
          const dsRes = await fetch(`/api/knowledge/items?collection_id=${dsCol.id}`);
          if (dsRes.ok) {
            const dsItemData = await dsRes.json() as KbItem[];
            const dsItems = (Array.isArray(dsItemData) ? dsItemData : []).map(item =>
              mapKbItemToLibrary(item as KbItem, tagMetaByName),
            );
            if (dsItems.length > 0) {
              const dsFolder: LibraryItem = {
                id: 'virtual:deepsearch-collection',
                type: '联网搜索',
                title: '联网搜索资料',
                preview: `${dsItems.length} 条来自互联网的搜索资料`,
                summary: '',
                keyPoints: [],
                path: '',
                timeLabel: '',
                date: '',
                fullDate: '',
                tags: [{ label: '联网搜索', type: 'system' }],
                isDirectory: true,
                isVirtual: true,
                children: dsItems,
              };
              rootItems.unshift(dsFolder);
            }
          }
        }
      }

      setItems((prev) => {
        const prevMap = new Map(prev.map((item) => [item.id, item]));
        return rootItems.map((item) => {
          const prevItem = prevMap.get(item.id);
          // Preserve expanded children for non-deepsearch folders
          if (prevItem?.children && item.id !== 'virtual:deepsearch-collection') {
            return { ...item, children: prevItem.children };
          }
          return item;
        });
      });
    } catch (error) {
      setItemsError(error instanceof Error ? error.message : "加载资料失败");
    } finally {
      if (!options?.silent) {
        setItemsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  useEffect(() => {
    const resolved = resolveItemsByPath(items, currentPath);
    if (resolved) {
      setCurrentItems(resolved);
      return;
    }
    if (currentPath.length > 0) {
      setCurrentPath([]);
    }
    setCurrentItems(items);
  }, [items, currentPath]);

  const hasActiveIngestJobs = ingestJobs.some((job) => job.status === "pending" || job.status === "running");

  useEffect(() => {
    if (!hasActiveIngestJobs) return;
    const timer = window.setInterval(() => {
      void loadItems({ silent: true });
    }, 3500);
    return () => window.clearInterval(timer);
  }, [hasActiveIngestJobs, loadItems]);

  const handleTagClick = (tagLabel: string) => {
    setSelectedTags(prev => {
      if (prev.includes(tagLabel)) {
        // 已选中，移除
        return prev.filter(t => t !== tagLabel);
      } else {
        // 未选中，添加
        return [...prev, tagLabel];
      }
    });
  };

  const removeTag = (tagLabel: string) => {
    setSelectedTags(prev => prev.filter(t => t !== tagLabel));
  };

  const clearAllFilters = () => {
    setViewMode("all");
    setFilter("all");
    setSearchQuery("");
    setSelectedTags([]);
    setFavoriteOnly(false);
    setShowTagSelector(false);
  };

  // 收藏功能
  const toggleFavorite = (id: string, e: React.MouseEvent) => {
    e.stopPropagation(); // 阻止事件冒泡
    setFavorites(prev => {
      const newFavorites = new Set(prev);
      if (newFavorites.has(id)) {
        newFavorites.delete(id);
      } else {
        newFavorites.add(id);
      }
      return newFavorites;
    });
  };

  const deleteItem = useCallback(async (item: LibraryItem) => {
    const canRemove = canRemoveLibraryItem(item);
    if (!canRemove) {
      alert("该资料当前不支持移除");
      return;
    }
    const deletingDirectory = isRootIngestDirectory(item);
    const confirmed = window.confirm(
      deletingDirectory
        ? `确定移除目录「${item.title}」吗？将清理该目录的后台任务与已入库资料。`
        : `确定移除「${item.title}」吗？该操作不可撤销。`,
    );
    if (!confirmed) return;

    setDeletingId(item.id);
    try {
      if (deletingDirectory) {
        if (!collectionId) {
          throw new Error("未找到默认资料集合");
        }
        await removeDirectoryKnowledge({
          collectionId,
          sourceDir: item.path,
        });
      } else {
        const res = await fetch("/api/knowledge/items", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: item.id }),
        });
        const data = await res.json();
        if (!res.ok || !data?.deleted) {
          throw new Error(data?.error || "移除失败");
        }
      }
      if (selectedItem?.id === item.id) {
        setShowDetail(false);
        setSelectedItem(null);
      }
      setCurrentPath([]);
      setCurrentItems([]);
      await loadItems();
    } catch (error) {
      alert(error instanceof Error ? error.message : "移除失败");
    } finally {
      setDeletingId(null);
    }
  }, [collectionId, loadItems, selectedItem]);

  const loadDirectoryChildren = useCallback(async (dirPath: string) => {
    const params = new URLSearchParams({
      dir: dirPath,
      depth: "1",
      baseDir: dirPath,
    });
    const res = await fetch(`/api/files?${params.toString()}`);
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data?.error || "读取目录失败");
    }
    const nodes: FileTreeNode[] = Array.isArray(data.tree) ? data.tree : [];
    return nodes.map(mapFileNodeToLibrary);
  }, []);

  const loadIngestJobChildren = useCallback(async (jobId: string) => {
    const { job, items: jobItems } = await getDirectoryImportJob(jobId, {
      includeItems: true,
      limit: 2000,
    });
    if (!job || !Array.isArray(jobItems)) {
      return [] as LibraryItem[];
    }
    return buildIngestJobChildren(job, jobItems, allKbItems);
  }, [allKbItems]);

  // 进入目录
  const enterDirectory = useCallback(async (item: LibraryItem) => {
    if (item.type !== "文件目录") return;
    setItemsError(null);
    let children = item.children;
    if (!children) {
      try {
        children = item.ingestJobId
          ? await loadIngestJobChildren(item.ingestJobId)
          : await loadDirectoryChildren(item.path);
        setItems((prev) => updateItemChildren(prev, item.id, children!));
      } catch (error) {
        const message = error instanceof Error ? error.message : "读取目录失败";
        setItemsError(message);
        return;
      }
    }
    if (!children) return;
    setCurrentPath((prev) => [...prev, { id: item.id, title: item.title }]);
    setCurrentItems(children);
  }, [loadDirectoryChildren, loadIngestJobChildren, setItemsError]);

  // 返回上一级目录
  const goBack = () => {
    if (currentPath.length === 0) return;
    setCurrentPath((prev) => prev.slice(0, -1));
  };

  const refreshCurrentView = useCallback(async () => {
    if (currentPath.length === 0) {
      await loadItems();
      return;
    }

    const root = currentPath[0];
    if (root.id.startsWith("ingest:")) {
      const jobId = root.id.slice("ingest:".length);
      try {
        const children = await loadIngestJobChildren(jobId);
        setItems((prev) => updateItemChildren(prev, root.id, children));
      } catch (error) {
        setItemsError(error instanceof Error ? error.message : "刷新目录失败");
      }
      return;
    }

    let target: LibraryItem | undefined;
    let layer = items;
    for (const pathItem of currentPath) {
      target = layer.find((entry) => entry.id === pathItem.id);
      if (!target) break;
      layer = target.children || [];
    }
    if (!target?.path) return;

    try {
      const children = await loadDirectoryChildren(target.path);
      setItems((prev) => updateItemChildren(prev, target!.id, children));
    } catch (error) {
      setItemsError(error instanceof Error ? error.message : "刷新目录失败");
    }
  }, [currentPath, items, loadDirectoryChildren, loadIngestJobChildren, loadItems]);

  const retryDirectoryProcessing = useCallback(async (item: LibraryItem, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!item.ingestJobId) return;

    const job = ingestJobs.find((entry) => entry.id === item.ingestJobId);
    if (!job) {
      await loadItems();
      return;
    }
    if (job.source_type === "file") {
      alert("单文件任务请使用“重试失败项”");
      return;
    }
    if (job.status === "running" || job.status === "pending") {
      alert("该目录仍在处理中，请稍后再试");
      return;
    }

    setRetryingDirectoryId(item.id);
    try {
      const hasRetryableErrors = Number(job.failed_files || 0) + Number(job.skipped_files || 0) > 0;
      if (hasRetryableErrors) {
        await retryDirectoryImportJob(job.id);
      } else {
        await importDirectory({
          directory: job.source_dir,
          collectionId: collectionId || undefined,
          recursive: job.recursive !== 0,
          baseDir: job.source_dir,
          mode: 'ingest',
          forceReprocess: true,
          maxFiles: Math.max(Number(job.max_files || 0), 2000),
          maxFileSize: Number(job.max_file_size || 20 * 1024 * 1024),
        });
      }
      await loadItems();
    } catch (error) {
      alert(error instanceof Error ? error.message : "目录重试失败");
    } finally {
      setRetryingDirectoryId(null);
    }
  }, [collectionId, ingestJobs, loadItems]);

  // 打开详情页（修改为支持目录导航）
  const openDetail = (item: LibraryItem) => {
    // 如果是文件目录，进入目录
    if (item.type === "文件目录") {
      void enterDirectory(item);
      return;
    }

    // 如果是联网搜索虚拟目录，直接展开（children 已预加载）
    if (item.type === "联网搜索" && item.children) {
      setCurrentPath((prev) => [...prev, { id: item.id, title: item.title }]);
      setCurrentItems(item.children);
      return;
    }

    // 否则打开详情页
    setSelectedItem(item);
    setShowDetail(true);
    setIsEditing(false);
    setSelectedItemFullContent("");
    setDetailContentLoading(false);
    setEditContent('');
    setEditFeedback(null);
  };

  // 关闭详情页
  const closeDetail = () => {
    setShowDetail(false);
    setIsEditing(false);
    setSelectedItemFullContent("");
    setDetailContentLoading(false);
    setEditFeedback(null);
    setTimeout(() => setSelectedItem(null), 300); // 等待动画结束
  };

  useEffect(() => {
    if (!showDetail || !selectedItem || selectedItem.isVirtual || selectedItem.type === "文件目录") {
      return;
    }

    let cancelled = false;
    const loadFullContent = async () => {
      setDetailContentLoading(true);
      try {
        const res = await fetch(`/api/knowledge/items/${encodeURIComponent(selectedItem.id)}`, {
          cache: "no-store",
        });
        const data = await res.json().catch(() => ({})) as Partial<KbItemDetail> & { error?: string };
        if (!res.ok) {
          throw new Error(data.error || "加载资料正文失败");
        }
        if (!cancelled) {
          setSelectedItemFullContent((data.full_content || data.content || "").trim());
        }
      } catch (error) {
        if (!cancelled) {
          setSelectedItemFullContent("");
          setEditFeedback((current) => current ?? {
            type: "error",
            message: error instanceof Error ? error.message : "加载资料正文失败",
          });
        }
      } finally {
        if (!cancelled) {
          setDetailContentLoading(false);
        }
      }
    };

    void loadFullContent();
    return () => {
      cancelled = true;
    };
  }, [showDetail, selectedItem?.id]);

  // 进入编辑模式
  const enterEditMode = () => {
    if (selectedItem) {
      if (selectedItem.isVirtual || selectedItem.type === "文件目录") {
        setEditFeedback({ type: "error", message: "该资料暂不支持在线编辑" });
        return;
      }
      if (detailContentLoading && !selectedItemFullContent.trim()) {
        setEditFeedback({ type: "error", message: "正文仍在加载，请稍后再试" });
        return;
      }
      setIsEditing(true);
      setEditFeedback(null);
      setEditContent(selectedItemFullContent.trim() || selectedItem.preview);
    }
  };

  // 保存编辑
  const saveEdit = async () => {
    if (!selectedItem) return;
    if (!editContent.trim()) {
      setEditFeedback({ type: "error", message: "内容不能为空" });
      return;
    }
    setEditSaving(true);
    setEditFeedback(null);
    try {
      const res = await fetch(`/api/knowledge/items/${encodeURIComponent(selectedItem.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: editContent }),
      });
      const data = await res.json();
      if (!res.ok || !data?.item) {
        throw new Error(data?.error || "保存失败");
      }
      const mapped = mapKbItemToLibrary(data.item as KbItem);
      const mergeItem = (origin: LibraryItem): LibraryItem => ({
        ...origin,
        ...mapped,
        children: origin.children,
      });
      setItems((prev) => patchItemInTree(prev, selectedItem.id, mergeItem));
      setCurrentItems((prev) => patchItemInTree(prev, selectedItem.id, mergeItem));
      setSelectedItem((prev) => (prev ? mergeItem(prev) : prev));
      setSelectedItemFullContent(editContent.trim());
      setIsEditing(false);
      setEditFeedback({ type: "success", message: "保存成功，知识索引已更新" });
    } catch (error) {
      setEditFeedback({ type: "error", message: error instanceof Error ? error.message : "保存失败" });
    } finally {
      setEditSaving(false);
    }
  };

  const reindexItem = useCallback(async (item: LibraryItem) => {
    if (item.isVirtual) {
      setEditFeedback({ type: "error", message: "该资料尚未入库，无法重建索引" });
      return;
    }
    setReindexingId(item.id);
    setEditFeedback(null);
    try {
      const res = await fetch(`/api/knowledge/items/${encodeURIComponent(item.id)}/reindex`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reparse: true }),
      });
      const data = await res.json();
      if (!res.ok || !data?.item) {
        throw new Error(data?.error || "重建索引失败");
      }
      const mapped = mapKbItemToLibrary(data.item as KbItem);
      const mergeItem = (origin: LibraryItem): LibraryItem => ({
        ...origin,
        ...mapped,
        children: origin.children,
      });
      setItems((prev) => patchItemInTree(prev, item.id, mergeItem));
      setCurrentItems((prev) => patchItemInTree(prev, item.id, mergeItem));
      setSelectedItem((prev) => (prev && prev.id === item.id ? mergeItem(prev) : prev));
      setEditFeedback({ type: "success", message: "索引重建完成" });
    } catch (error) {
      setEditFeedback({ type: "error", message: error instanceof Error ? error.message : "重建索引失败" });
    } finally {
      setReindexingId(null);
    }
  }, []);

  // 取消编辑
  const cancelEdit = () => {
    setIsEditing(false);
    setEditContent('');
    setEditFeedback(null);
  };

  // ESC 键关闭详情页
  React.useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && showDetail) {
        closeDetail();
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [showDetail]);

  // 过滤管线：视图 -> 类型 -> 标签 -> 搜索
  const viewFilteredItems = currentItems.filter((item) => {
    if (item.isDirectory) return true; // 目录始终显示
    if (viewMode === "all") return true;
    if (viewMode === "recent") return isRecentUpdate(item.updatedAt, 7);
    if (viewMode === "ready") return isReadyStatus(item.processingStatus);
    return isAttentionStatus(item.processingStatus);
  });

  const typeFilteredItems = viewFilteredItems.filter((item) => matchesTypeFilter(item, filter));

  const tagFilteredItems = typeFilteredItems.filter((item) => {
    if (selectedTags.length === 0) return true;
    const itemTagLabels = item.tags?.map((tag) => tag.label) || [];
    return tagFilterMode === "and"
      ? selectedTags.every((tag) => itemTagLabels.includes(tag))
      : selectedTags.some((tag) => itemTagLabels.includes(tag));
  });

  const favoriteFilteredItems = tagFilteredItems.filter((item) => {
    if (!favoriteOnly) return true;
    return favorites.has(item.id);
  });

  const query = searchQuery.trim().toLowerCase();
  const filteredItems = favoriteFilteredItems.filter((item) => {
    if (!query) return true;
    const titleMatch = item.title.toLowerCase().includes(query);
    const previewMatch = item.preview.toLowerCase().includes(query);
    const tagMatch = item.tags?.some((tag) => tag.label.toLowerCase().includes(query));
    const pathMatch = (item.displayPath || item.path).toLowerCase().includes(query);
    return titleMatch || previewMatch || tagMatch || pathMatch;
  });

  const sortedFilteredItems = [...filteredItems].sort((a, b) => {
    // 联网搜索虚拟目录始终置顶
    if (a.id === "virtual:deepsearch-collection") return -1;
    if (b.id === "virtual:deepsearch-collection") return 1;

    const timeA = Date.parse(a.updatedAt || "") || 0;
    const timeB = Date.parse(b.updatedAt || "") || 0;
    const titleA = a.title || "";
    const titleB = b.title || "";

    if (sortMode === "updated_desc") return timeB - timeA;
    if (sortMode === "updated_asc") return timeA - timeB;
    if (sortMode === "title_asc") return titleA.localeCompare(titleB, "zh-Hans-CN", { sensitivity: "base" });
    return titleB.localeCompare(titleA, "zh-Hans-CN", { sensitivity: "base" });
  });

  const catalogMetaByName = new Map(
    tagCatalog.map((tag) => [String(tag.name || '').trim().toLowerCase(), tag]),
  );

  // 收集当前目录可用标签及其使用次数（按标签体系分类）
  const allTags = currentItems.reduce((acc, item) => {
    item.tags?.forEach((tag) => {
      const key = tag.label.toLowerCase();
      const meta = catalogMetaByName.get(key);
      if (acc[key]) {
        acc[key].count += 1;
      } else {
        const category = meta?.category || tag.category || "custom";
        acc[key] = {
          label: tag.label,
          type: category === "custom" ? "custom" : "ai",
          category,
          color: meta?.color || tag.color,
          count: 1,
        };
      }
    });
    return acc;
  }, {} as Record<string, { label: string; type: "custom" | "ai" | "system"; category: TagCatalogItem["category"]; color?: string; count: number }>);

  // 转换为数组并按使用次数排序
  const sortedTags = Object.values(allTags).sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.label.localeCompare(b.label, "zh-Hans-CN", { sensitivity: "base" });
  });
  const tagsGroupedByCategory = TAG_CATEGORY_ORDER
    .map((category) => ({
      category,
      label: TAG_CATEGORY_LABEL[category],
      tags: sortedTags.filter((tag) => tag.category === category),
    }))
    .filter((entry) => entry.tags.length > 0);
  const canReindexSelected = !!selectedItem && !selectedItem.isVirtual;
  const detailPreviewContent = (selectedItemFullContent || selectedItem?.preview || "").trim();
  const hasAttentionItem = currentItems.some((item) => isAttentionStatus(item.processingStatus));
  const hasReadyItem = currentItems.some((item) => isReadyStatus(item.processingStatus));
  const hasRecentItem = currentItems.some((item) => isRecentUpdate(item.updatedAt, 7));
  const hasActiveFilters = !!query || filter !== "all" || viewMode !== "all" || selectedTags.length > 0 || favoriteOnly;
  const activeFilterCount = (query ? 1 : 0) + (viewMode !== "all" ? 1 : 0) + (filter !== "all" ? 1 : 0) + selectedTags.length + (favoriteOnly ? 1 : 0);
  const totalInScope = currentItems.length;
  const filteredCount = sortedFilteredItems.length;
  const activeIngestJobs = ingestJobs.filter((job) => job.status === "pending" || job.status === "running");
  const ingestTotalFiles = activeIngestJobs.reduce((sum, job) => sum + Number(job.total_files || 0), 0);
  const ingestProcessedFiles = activeIngestJobs.reduce((sum, job) => sum + Number(job.processed_files || 0), 0);

  return (
    <div className="flex h-full flex-col bg-background">
      {/* 主内容区 */}
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-6xl px-4 py-4 sm:px-6 lg:px-8 lg:py-5 space-y-4">

          <section className="sticky top-2 z-20 rounded-xl border border-border/70 bg-background/95 p-3 shadow-sm backdrop-blur">
            <div className="flex flex-col gap-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-0 flex-1">
                  <HugeiconsIcon icon={Search} className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="text"
                    placeholder="搜索资料"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full min-w-0 rounded-lg border border-border bg-background py-2 pl-9 pr-4 text-sm outline-none transition-colors focus:border-primary/50"
                  />
                </div>
                <LibraryImportPanel
                  collectionId={collectionId}
                  onImported={loadItems}
                  triggerClassName={TOP_ACTION_BUTTON_CLASS}
                />
                <button
                  onClick={() => void refreshCurrentView()}
                  className={TOP_ACTION_BUTTON_CLASS}
                >
                  刷新
                </button>
                <button
                  onClick={() => router.push("/settings#knowledge")}
                  className={TOP_ACTION_BUTTON_CLASS}
                >
                  检索设置
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={viewMode}
                  onChange={(e) => setViewMode(e.target.value as ViewMode)}
                  className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs text-foreground outline-none transition-colors focus:border-primary/50"
                >
                  {VIEW_MODE_OPTIONS.map((option) => (
                    <option
                      key={option.key}
                      value={option.key}
                      disabled={
                        option.key === "recent"
                          ? !hasRecentItem
                          : option.key === "ready"
                            ? !hasReadyItem
                            : option.key === "attention"
                              ? !hasAttentionItem
                              : false
                      }
                    >
                      {option.label}
                    </option>
                  ))}
                </select>

                <select
                  value={filter}
                  onChange={(e) => setFilter(e.target.value as TypeFilter)}
                  className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs text-foreground outline-none transition-colors focus:border-primary/50"
                >
                  {TYPE_FILTER_OPTIONS.map((option) => (
                    <option
                      key={option.key}
                      value={option.key}
                      disabled={option.key !== "all" && !viewFilteredItems.some((item) => matchesTypeFilter(item, option.key))}
                    >
                      {option.label}
                    </option>
                  ))}
                </select>

                <select
                  value={sortMode}
                  onChange={(e) => setSortMode(e.target.value as SortMode)}
                  className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs text-foreground outline-none transition-colors focus:border-primary/50"
                >
                  {SORT_MODE_OPTIONS.map((option) => (
                    <option key={option.key} value={option.key}>
                      {option.label}
                    </option>
                  ))}
                </select>

                <button
                  onClick={() => setFavoriteOnly((prev) => !prev)}
                  className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                    favoriteOnly
                      ? "border-primary/60 bg-primary/10 text-primary"
                      : "border-border bg-background text-muted-foreground hover:bg-accent"
                  }`}
                >
                  仅收藏
                </button>

                <div className="relative">
                  <button
                    onClick={() => setShowTagSelector(!showTagSelector)}
                    className="inline-flex items-center gap-1 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-medium hover:bg-accent transition-colors"
                  >
                    标签
                    {selectedTags.length > 0 ? (
                      <span className="rounded bg-accent px-1.5 py-0.5 text-[10px] text-muted-foreground">{selectedTags.length}</span>
                    ) : null}
                  </button>

                  {showTagSelector && (
                    <>
                      <div
                        className="fixed inset-0 z-10"
                        onClick={() => setShowTagSelector(false)}
                      />
                      <div className="absolute top-full left-0 z-20 mt-2 max-h-80 w-[min(24rem,calc(100vw-2rem))] overflow-auto rounded-lg border border-border bg-popover p-3 shadow-lg">
                        <div className="space-y-3">
                          <div className="flex items-center justify-between px-1">
                            <span className="text-xs font-medium text-muted-foreground">选择标签</span>
                            <span className="text-xs text-muted-foreground">{sortedTags.length} 个标签</span>
                          </div>
                          <div className="rounded-md bg-muted/50 px-2.5 py-1.5 text-[11px] text-muted-foreground">
                            标签体系会在资料入库或重建索引后自动更新。
                          </div>
                          {tagsGroupedByCategory.map((group) => (
                            <div key={group.category} className="space-y-1.5">
                              <div className="text-[11px] font-medium text-muted-foreground">{group.label}</div>
                              <div className="flex flex-wrap items-center gap-2">
                                {group.tags.map((tag) => {
                                  const isSelected = selectedTags.includes(tag.label);
                                  const getTagStyle = () => {
                                    if (tag.type === "custom") {
                                      const colors: Record<string, string> = {
                                        red: "bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-500/20",
                                        orange: "bg-orange-500/10 text-orange-600 dark:text-orange-400 hover:bg-orange-500/20",
                                        yellow: "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 hover:bg-yellow-500/20",
                                        green: "bg-green-500/10 text-green-600 dark:text-green-400 hover:bg-green-500/20",
                                        blue: "bg-blue-500/10 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20",
                                        purple: "bg-purple-500/10 text-purple-600 dark:text-purple-400 hover:bg-purple-500/20",
                                      };
                                      return colors[tag.color || "blue"] || colors.blue;
                                    }
                                    if (tag.type === "ai") {
                                      return "border border-blue-500/50 bg-transparent text-blue-600 hover:bg-blue-500/10 dark:text-blue-400";
                                    }
                                    return "bg-gray-500/10 text-gray-600 hover:bg-gray-500/20 dark:text-gray-400";
                                  };

                                  return (
                                    <button
                                      key={tag.label}
                                      onClick={() => handleTagClick(tag.label)}
                                      className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-all ${
                                        isSelected ? "ring-2 ring-primary ring-offset-1 ring-offset-popover" : ""
                                      } ${getTagStyle()}`}
                                    >
                                      {tag.label}
                                      <span className="text-[10px] opacity-60">({tag.count})</span>
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          ))}
                          {tagsGroupedByCategory.length === 0 ? (
                            <div className="rounded-md border border-dashed border-border px-2.5 py-3 text-center text-xs text-muted-foreground">
                              暂无可用标签，导入资料后会自动构建标签体系
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </>
                  )}
                </div>

                <div className="ml-auto flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {filteredCount} / {totalInScope}
                  </span>
                  {hasActiveFilters ? (
                    <button
                      onClick={clearAllFilters}
                      className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-medium hover:bg-accent transition-colors"
                    >
                      清空 {activeFilterCount}
                    </button>
                  ) : null}
                </div>
              </div>

              {hasActiveIngestJobs ? (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50/70 px-2.5 py-1.5 text-[11px] text-amber-800">
                  <span className="font-medium">后台入库进行中</span>
                  <span>{activeIngestJobs.length} 个文件夹任务</span>
                  <span>{ingestProcessedFiles}/{ingestTotalFiles || 0} 文件已处理</span>
                  <button
                    onClick={() => void refreshCurrentView()}
                    className="ml-auto rounded border border-amber-300 bg-white px-2 py-0.5 text-[11px] text-amber-700 hover:bg-amber-100"
                  >
                    刷新状态
                  </button>
                </div>
              ) : null}

              {selectedTags.length > 0 ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  {selectedTags.map((tag, i) => (
                    <React.Fragment key={tag}>
                      {i > 0 && selectedTags.length > 1 && (
                        <button
                          onClick={() => setTagFilterMode((m) => m === "or" ? "and" : "or")}
                          className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                          title="点击切换 或/且"
                        >
                          {tagFilterMode === "or" ? "或" : "且"}
                        </button>
                      )}
                      <button
                        onClick={() => removeTag(tag)}
                        className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent transition-colors"
                      >
                        {tag}
                        <span>×</span>
                      </button>
                    </React.Fragment>
                  ))}
                </div>
              ) : null}
            </div>
          </section>

          {itemsError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600">
              {itemsError}
            </div>
          )}

          {/* 面包屑导航 */}
          {currentPath.length > 0 && (
            <div className="flex items-center gap-2 text-sm">
              <button
                onClick={goBack}
                className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                返回
              </button>
              <span className="text-muted-foreground">/</span>
              <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      setCurrentPath([]);
                    }}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                  >
                  资料库
                </button>
                {currentPath.map((pathItem, index) => (
                  <div key={pathItem.id} className="flex items-center gap-2">
                    <span className="text-muted-foreground">/</span>
                    <span className={index === currentPath.length - 1 ? "text-foreground font-medium" : "text-muted-foreground"}>
                      {pathItem.title}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 内容卡片网格 */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {itemsLoading ? (
              <div className="col-span-full flex flex-col items-center justify-center py-16 text-center">
                <div className="text-sm text-muted-foreground">加载资料中...</div>
              </div>
            ) : sortedFilteredItems.length > 0 ? (
              sortedFilteredItems.map((item) => {
                const job = item.ingestJobId ? ingestJobs.find((entry) => entry.id === item.ingestJobId) : undefined;
                const showDirectoryRetry = Boolean(
                  item.ingestJobId
                  && item.type === "文件目录"
                  && job
                  && job.status !== "running"
                  && job.status !== "pending",
                );
                const hasRetryableErrors = Number(job?.failed_files || 0) + Number(job?.skipped_files || 0) > 0;
                return (
                  <ContentCard
                    key={item.id}
                    item={item}
                    onTagClick={handleTagClick}
                    selectedTags={selectedTags}
                    isFavorite={favorites.has(item.id)}
                    onToggleFavorite={toggleFavorite}
                    onClick={openDetail}
                    onDelete={(target, e) => {
                      e.stopPropagation();
                      deleteItem(target);
                    }}
                    deleting={deletingId === item.id}
                    showDirectoryRetry={showDirectoryRetry}
                    directoryRetrying={retryingDirectoryId === item.id}
                    directoryRetryLabel={hasRetryableErrors ? "重试失败项" : "重处理目录"}
                    onDirectoryRetry={retryDirectoryProcessing}
                  />
                );
              })
            ) : (
              <div className="col-span-full flex flex-col items-center justify-center py-16 text-center">
                  <h3 className="text-lg font-medium text-foreground mb-2">未找到相关资料</h3>
                  <p className="text-sm text-muted-foreground">
                    {searchQuery ? `没有找到包含“${searchQuery}”的资料` : "该分类下暂无资料"}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 底部 AI 对话框 */}
      <BottomChatPanel>
        {({ collapsed, expand }) => (
          <LibraryChatPanel
            compactInputOnly={collapsed}
            fullWidth
            hideEmptyState
            onInputFocus={expand}
          />
        )}
      </BottomChatPanel>

      {/* 详情页模态框 */}
      {showDetail && selectedItem && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-200"
          onClick={closeDetail}
        >
          <div
            className="relative w-full max-w-4xl max-h-[90vh] m-4 bg-background rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 头部 */}
            <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 border-b border-border bg-background/95 backdrop-blur">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <FileTypeLogo type={selectedItem.type} />
                <div className="flex-1 min-w-0">
                  <h2 className="text-lg font-semibold truncate">{selectedItem.title}</h2>
                  <p className="text-sm text-muted-foreground">{selectedItem.type} · {selectedItem.date}</p>
                  {selectedItem.processingStatus ? (
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${processingMeta(selectedItem.processingStatus).className}`}>
                        {processingMeta(selectedItem.processingStatus).label}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {processingMeta(selectedItem.processingStatus).brief}
                      </span>
                    </div>
                  ) : null}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (selectedItem) {
                      void reindexItem(selectedItem);
                    }
                  }}
                  disabled={!canReindexSelected || reindexingId === selectedItem?.id}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
                    !canReindexSelected
                      ? "bg-muted text-muted-foreground cursor-not-allowed"
                      : "bg-sky-500/10 text-sky-700 hover:bg-sky-500/20"
                  }`}
                  title="重新解析并重建索引"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m14.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0A8.003 8.003 0 015.582 15m13.837 0H15" />
                  </svg>
                  {reindexingId === selectedItem?.id ? "重建中..." : "重建索引"}
                </button>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (selectedItem) {
                      deleteItem(selectedItem);
                    }
                  }}
                  disabled={!selectedItem || !canRemoveLibraryItem(selectedItem) || deletingId === selectedItem?.id}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
                    !selectedItem || !canRemoveLibraryItem(selectedItem)
                      ? "bg-muted text-muted-foreground cursor-not-allowed"
                      : "bg-red-500/10 text-red-600 hover:bg-red-500/20"
                  }`}
                  title={removeDisabledReason(selectedItem)}
                >
                  <HugeiconsIcon icon={Delete} className="h-4 w-4" />
                  移除
                </button>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleFavorite(selectedItem.id, e);
                  }}
                  className="p-2 rounded-lg hover:bg-accent transition-colors"
                  title={favorites.has(selectedItem.id) ? "取消收藏" : "收藏"}
                >
                  {favorites.has(selectedItem.id) ? (
                    <svg className="w-5 h-5 text-yellow-500 fill-current" viewBox="0 0 24 24">
                      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                    </svg>
                  )}
                </button>
                <button
                  onClick={closeDetail}
                  className="p-2 rounded-lg hover:bg-accent transition-colors"
                  title="关闭 (ESC)"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* 内容区 */}
            <div className="overflow-y-auto max-h-[calc(90vh-180px)] px-6 py-6">
              {/* 编辑模式 */}
              {isEditing ? (
                <div className="grid grid-cols-2 gap-4 h-full">
                  {/* 左侧：编辑器 */}
                  <div className="flex flex-col">
                    <div className="text-sm font-medium text-muted-foreground mb-2">编辑器</div>
                    <textarea
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      className="flex-1 w-full p-4 rounded-lg border border-border bg-background font-mono text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary"
                      placeholder="在这里编辑内容..."
                    />
                      <div className="text-xs text-muted-foreground mt-2">
                        保存后会同步更新该资料的检索索引
                      </div>
                    </div>

                  {/* 右侧：实时预览 */}
                  <div className="flex flex-col">
                    <div className="text-sm font-medium text-muted-foreground mb-2">实时预览</div>
                    <div className="flex-1 p-4 rounded-lg border border-border bg-muted/30 overflow-y-auto">
                      <div className="prose prose-sm dark:prose-invert max-w-none">
                        {editContent.split('\n').map((line, i) => {
                          if (line.startsWith('# ')) {
                            return <h1 key={i}>{line.slice(2)}</h1>;
                          } else if (line.startsWith('## ')) {
                            return <h2 key={i}>{line.slice(3)}</h2>;
                          } else if (line.startsWith('### ')) {
                            return <h3 key={i}>{line.slice(4)}</h3>;
                          } else if (line.trim() === '') {
                            return <br key={i} />;
                          } else {
                            return <p key={i}>{line}</p>;
                          }
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                /* 预览模式 */
                <div className="space-y-4">
                  {selectedItem.summary ? (
                    <div className="rounded-lg border border-border bg-muted/30 p-4">
                      <h3 className="text-sm font-medium mb-2">索引概述</h3>
                      <p className="whitespace-pre-wrap text-sm text-foreground leading-relaxed">
                        {selectedItem.summary}
                      </p>
                    </div>
                  ) : null}
                  <div className="rounded-lg border border-border bg-muted/30 p-4 overflow-hidden">
                    <h3 className="text-sm font-medium mb-2">内容预览</h3>
                    <LibraryContentPreview
                      item={selectedItem}
                      textContent={detailPreviewContent}
                    />
                  </div>
                  {selectedItem.keyPoints.length > 0 ? (
                    <div className="rounded-lg border border-border bg-background p-3">
                      <div className="text-xs text-muted-foreground">关键要点</div>
                      <ul className="mt-2 space-y-1.5 text-sm text-foreground">
                        {selectedItem.keyPoints.map((point, index) => (
                          <li key={`${selectedItem.id}-kp-${index}`} className="flex gap-2">
                            <span className="mt-0.5 text-muted-foreground">{index + 1}.</span>
                            <span className="leading-relaxed">{point}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {(selectedItem.displayPath || selectedItem.path) && (
                    <div className="rounded-lg border border-border bg-background p-3">
                      <div className="text-xs text-muted-foreground">来源</div>
                      <div className="mt-1 text-sm break-all">{selectedItem.displayPath || selectedItem.path}</div>
                    </div>
                  )}
                  {shouldShowKnowledgeEnhancementHint(selectedItem) ? (
                    <div className="rounded-lg border border-sky-200 bg-sky-50 p-3">
                      <div className="text-xs text-sky-700">AI 增强未启用</div>
                      <div className="mt-1 text-sm text-sky-700">
                        当前已完成本地索引与检索，但未生成概述、要点和自动标签。请在“设置 &gt; 服务商”里为知识库选择一个支持文本处理的 API Key 服务。
                      </div>
                    </div>
                  ) : null}
                  {selectedItem.processingError ? (
                    <div className="rounded-lg border border-rose-200 bg-rose-50 p-3">
                      <div className="text-xs text-rose-700">处理异常</div>
                      <div className="mt-1 text-sm text-rose-700 break-all">{selectedItem.processingError}</div>
                    </div>
                  ) : null}
                </div>
              )}
              {/* 标签 */}
              {selectedItem.tags && selectedItem.tags.length > 0 && (
                <div className="mt-4 mb-6 rounded-xl border border-border bg-background p-4">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-sm font-medium">标签</h3>
                    <span className="text-xs text-muted-foreground">{selectedItem.tags.length} 个</span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {selectedItem.tags.map((tag, index) => {
                      return (
                        <span
                          key={index}
                          className={`inline-flex items-center gap-2 rounded-full font-medium ${getTagStyle(tag)}`}
                        >
                          <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
                          {tag.label}
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 元信息 */}
              <div className="border-t border-border pt-4">
                <div className="grid gap-4 text-sm sm:grid-cols-2">
                  <div className="rounded-xl border border-border bg-background p-4">
                    <span className="text-muted-foreground">类型</span>
                    <div className="mt-2 flex items-center gap-3">
                      <div className="shrink-0 scale-[0.88] transform-gpu">
                        <FileTypeLogo type={selectedItem.type} />
                      </div>
                      <p className="font-medium">{selectedItem.type}</p>
                    </div>
                  </div>
                  <div className="rounded-xl border border-border bg-background p-4">
                    <span className="text-muted-foreground">{selectedItem.timeLabel}</span>
                    <p className="font-medium mt-1">{selectedItem.fullDate}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* 底部操作栏 */}
            <div className="sticky bottom-0 flex items-center justify-end gap-2 px-6 py-4 border-t border-border bg-background/95 backdrop-blur">
              {editFeedback ? (
                <div
                  className={`mr-auto rounded-lg px-3 py-1.5 text-xs ${
                    editFeedback.type === "success"
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-rose-100 text-rose-700"
                  }`}
                >
                  {editFeedback.message}
                </div>
              ) : null}
              {isEditing ? (
                <>
                  <button
                    onClick={cancelEdit}
                    disabled={editSaving}
                    className="px-4 py-2 rounded-lg text-sm font-medium hover:bg-accent transition-colors disabled:opacity-50"
                  >
                    取消
                  </button>
                  <button
                    onClick={() => void saveEdit()}
                    disabled={editSaving}
                    className="px-4 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                  >
                    {editSaving ? "保存中..." : "保存"}
                  </button>
                </>
              ) : (
                <button
                  onClick={enterEditMode}
                  disabled={detailContentLoading}
                  className="px-4 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  {detailContentLoading ? "正文加载中..." : "编辑"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ContentCard({
  item,
  onTagClick,
  selectedTags,
  isFavorite,
  onToggleFavorite,
  onClick,
  onDelete,
  deleting,
  showDirectoryRetry = false,
  directoryRetrying = false,
  directoryRetryLabel = "重试",
  onDirectoryRetry,
}: {
  item: LibraryItem;
  onTagClick: (tagLabel: string) => void;
  selectedTags: string[];
  isFavorite: boolean;
  onToggleFavorite: (id: string, e: React.MouseEvent) => void;
  onClick: (item: LibraryItem) => void;
  onDelete: (item: LibraryItem, e: React.MouseEvent) => void;
  deleting: boolean;
  showDirectoryRetry?: boolean;
  directoryRetrying?: boolean;
  directoryRetryLabel?: string;
  onDirectoryRetry?: (item: LibraryItem, e: React.MouseEvent) => void;
}) {
  const summaryText = (item.summary || item.preview || "").trim();
  const canDelete = canRemoveLibraryItem(item);
  // 标签最多显示3个
  const visibleTags = item.tags?.slice(0, 3) || [];
  const remainingCount = (item.tags?.length || 0) - visibleTags.length;

  // 联网搜索虚拟目录 — 全宽横幅卡片
  if (item.type === "联网搜索") {
    const count = item.children?.length ?? 0;
    return (
      <div
        onClick={() => onClick(item)}
        className="col-span-full group relative flex cursor-pointer items-center overflow-hidden rounded-xl bg-gradient-to-r from-sky-500 via-sky-500 to-blue-600 px-5 py-4 shadow-sm transition-all hover:shadow-md hover:shadow-sky-300/40 dark:from-sky-600 dark:via-sky-600 dark:to-blue-700 dark:hover:shadow-sky-800/40"
      >
        {/* 背景装饰：大地球轮廓 */}
        <svg
          className="pointer-events-none absolute right-0 top-1/2 h-32 w-32 -translate-y-1/2 translate-x-8 text-white/[0.07]"
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
        </svg>

        {/* 图标 */}
        <div className="mr-4 shrink-0 rounded-lg bg-white/15 p-2.5 backdrop-blur-sm">
          <svg className="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
          </svg>
        </div>

        {/* 文字区 */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-white">{item.title}</h3>
            <span className="rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-medium text-white/90">
              自动归档
            </span>
          </div>
          <p className="mt-0.5 text-xs text-white/65">
            DeepSearch 联网搜索的网页内容，可在对话中直接引用检索
          </p>
        </div>

        {/* 右侧：条数 + 箭头 */}
        <div className="ml-4 flex shrink-0 items-center gap-3">
          <div className="text-right">
            <div className="text-xl font-bold leading-none text-white">{count}</div>
            <div className="mt-0.5 text-[10px] text-white/60">条网页资料</div>
          </div>
          <svg
            className="h-4 w-4 text-white/60 transition-transform group-hover:translate-x-0.5 group-hover:text-white"
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </div>
      </div>
    );
  }

  return (
    <div
      onClick={() => onClick(item)}
      className="group relative flex h-full cursor-pointer flex-col rounded-xl border border-border bg-card p-4 transition-all hover:scale-[1.01] hover:border-primary/50 hover:shadow-md"
    >
      <div className="flex h-full flex-col">
        {/* 顶部：Logo + 标题（单行）+ 操作按钮（右对齐） */}
        <div className="space-y-2.5">
          <div className="flex items-center gap-2.5">
            <div className="shrink-0 scale-[0.88] transform-gpu">
              <FileTypeLogo type={item.type} />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="truncate text-sm font-medium" title={item.title}>
                {item.title}
              </h3>
            </div>
            <div className="ml-1 flex shrink-0 items-center gap-1">
              <button
                onClick={(e) => onDelete(item, e)}
                disabled={!canDelete || deleting}
                className={`rounded-md p-1 transition-all ${
                  !canDelete
                    ? "cursor-not-allowed text-muted-foreground/50"
                    : "text-red-500 hover:bg-red-500/10"
                }`}
                title={removeDisabledReason(item)}
              >
                <HugeiconsIcon icon={Delete} className="h-4 w-4" />
              </button>

              <button
                onClick={(e) => onToggleFavorite(item.id, e)}
                className="rounded-md p-1 text-muted-foreground transition-all hover:bg-accent hover:text-foreground"
                title={isFavorite ? "取消收藏" : "收藏"}
              >
                {isFavorite ? (
                  <svg className="h-4 w-4 text-yellow-500 fill-current" viewBox="0 0 24 24">
                    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                  </svg>
                ) : (
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          {/* 概况：整行展示 */}
          <div className="flex min-h-[4.5rem] rounded-md bg-muted/40 px-2.5 py-1.5">
            <p className="line-clamp-3 text-xs leading-relaxed text-muted-foreground">
              {summaryText || "暂无概述"}
            </p>
          </div>
        </div>

        <div className="mt-auto space-y-2.5 pt-2.5">
          {/* 路径信息 */}
          {(item.displayPath || item.path) && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground/70">
              <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
              </svg>
              <span className="truncate" title={item.displayPath || item.path}>{item.displayPath || item.path}</span>
            </div>
          )}

          {/* 标签 */}
          {item.tags && item.tags.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              {visibleTags.map((tag, index) => {
                const isSelected = selectedTags.includes(tag.label);
                return (
                  <button
                    key={index}
                    onClick={(e) => {
                      e.stopPropagation();
                      onTagClick(tag.label);
                    }}
                    className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium transition-all hover:scale-105 ${
                      isSelected
                        ? 'ring-2 ring-primary ring-offset-1 ring-offset-background'
                        : ''
                    } ${getTagStyle(tag, { compact: true })}`}
                  >
                    {tag.label}
                  </button>
                );
              })}
              {remainingCount > 0 && (
                <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-gray-500/10 text-gray-600 dark:text-gray-400">
                  +{remainingCount}
                </span>
              )}
            </div>
          )}

          {/* 元信息 */}
          <div className="flex items-center justify-between gap-2 text-xs">
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-muted-foreground">{item.type}</span>
              {item.processingStatus ? (
                <span className={`inline-flex shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${processingMeta(item.processingStatus).className}`}>
                  {processingMeta(item.processingStatus).label}
                </span>
              ) : null}
              {showDirectoryRetry && onDirectoryRetry ? (
                <button
                  onClick={(e) => onDirectoryRetry(item, e)}
                  disabled={directoryRetrying}
                  className="inline-flex shrink-0 rounded border border-border bg-background px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-accent disabled:opacity-50"
                  title={directoryRetryLabel}
                >
                  {directoryRetrying ? "处理中..." : directoryRetryLabel}
                </button>
              ) : null}
            </div>
            <span className="text-muted-foreground" title={item.fullDate}>
              {item.timeLabel} {item.date}
            </span>
          </div>
        </div>
      </div>

    </div>
  );
}
