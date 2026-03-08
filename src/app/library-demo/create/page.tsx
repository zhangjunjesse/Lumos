"use client";

import React, { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { MessageInput } from "@/components/chat/MessageInput";

type KbItem = {
  id: string;
  title: string;
  source_type: string;
  source_path: string;
  content: string;
  tags: string;
  created_at: string;
  updated_at: string;
};

function sourceLabel(item: KbItem) {
  if (item.source_type === "webpage") return "网页";
  if (item.source_type === "feishu") return "飞书文档";
  if (item.source_type === "manual") return "文本";
  if (item.source_path) {
    const ext = item.source_path.split(".").pop()?.toLowerCase();
    if (ext === "pdf") return "PDF 文档";
    if (ext === "docx") return "Word 文档";
    if (ext === "xlsx" || ext === "xls" || ext === "csv") return "Excel 表格";
    if (ext === "md" || ext === "mdx") return "Markdown";
  }
  return "本地文件";
}

export default function CreatePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const itemId = searchParams.get("itemId");

  const [item, setItem] = useState<KbItem | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [messages, setMessages] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
  const [isStreaming, setIsStreaming] = useState(false);

  useEffect(() => {
    if (!itemId) return;
    let cancelled = false;
    const load = async () => {
      try {
        setLoadError(null);
        const res = await fetch(`/api/knowledge/items/${itemId}`);
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data?.error || "加载资料失败");
        }
        const data = (await res.json()) as KbItem;
        if (!cancelled) {
          setItem(data);
        }
      } catch (error) {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : "加载资料失败");
        }
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [itemId]);

  const handleSend = (content: string) => {
    // 添加用户消息
    setMessages(prev => [...prev, { role: 'user', content }]);
    setIsStreaming(true);

    // 模拟 AI 回复
    setTimeout(() => {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `基于《${item?.title}》的内容，我可以帮你：\n\n1. 扩展和深化相关主题\n2. 生成相关的文档或代码\n3. 回答你的问题\n4. 提供创作建议\n\n请告诉我你想要做什么？`
      }]);
      setIsStreaming(false);
    }, 1000);
  };

  const tags = (() => {
    if (!item) return [] as string[];
    try {
      const parsed = JSON.parse(item.tags || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  })();
  const typeLabel = item ? sourceLabel(item) : "-";
  const updatedAtLabel = item
    ? new Date(item.updated_at || item.created_at).toLocaleDateString()
    : "-";

  if (loadError) {
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-destructive">{loadError}</p>
        </div>
      </div>
    );
  }

  if (!item) {
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-muted-foreground">加载中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* 顶部导航栏 */}
      <div className="h-14 border-b border-border flex items-center justify-between px-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="p-2 hover:bg-accent rounded-lg transition-colors"
            title="返回"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="text-lg font-semibold">基于《{item.title}》创作</h1>
        </div>
      </div>

      {/* 主内容区 */}
      <div className="flex-1 flex overflow-hidden">
        {/* 左侧：资料预览 */}
        <div className="flex-1 overflow-auto p-6">
          <div className="max-w-4xl mx-auto">
            {/* 资料信息 */}
            <div className="mb-6 p-4 bg-accent/50 rounded-lg">
              <h2 className="text-xl font-bold mb-2">{item.title}</h2>
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <span>{typeLabel}</span>
                <span>·</span>
                <span>{updatedAtLabel}</span>
              </div>
              <div className="flex gap-2 mt-3">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="px-2 py-1 bg-primary/10 text-primary text-xs rounded"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>

            {/* 资料内容预览 */}
            <div className="prose prose-sm max-w-none">
              <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">
                {item.content || "内容已入库，可在资料库中查看完整内容。"}
              </pre>
            </div>
          </div>
        </div>

        {/* 右侧：AI 对话 */}
        <div className="w-96 border-l border-border flex flex-col bg-background">
          {/* 对话框头部 */}
          <div className="h-14 border-b border-border flex items-center px-4">
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
              </svg>
              <span className="text-sm font-medium">AI 助手</span>
            </div>
          </div>

          {/* 对话消息列表 */}
          <div className="flex-1 overflow-auto p-4 space-y-4">
            {messages.length === 0 ? (
              <div className="h-full flex items-center justify-center">
                <div className="text-center text-muted-foreground text-sm">
                  <svg className="w-12 h-12 mx-auto mb-3 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                  </svg>
                  <p>开始与 AI 对话</p>
                  <p className="text-xs mt-1">基于左侧资料进行创作</p>
                </div>
              </div>
            ) : (
              messages.map((msg, idx) => (
                <div
                  key={idx}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[85%] rounded-lg px-4 py-2 ${
                      msg.role === 'user'
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-accent'
                    }`}
                  >
                    <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* 输入框 */}
          <div className="border-t border-border p-3">
            <MessageInput
              onSend={handleSend}
              isStreaming={isStreaming}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
