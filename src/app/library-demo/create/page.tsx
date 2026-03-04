"use client";

import React, { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { MessageInput } from "@/components/chat/MessageInput";

// Mock 数据（与 library-demo 保持一致）
const mockItems = [
  {
    id: "1",
    title: "React 19 新特性",
    type: "Markdown",
    preview: "React 19 引入了多个重要特性，包括 Server Components、Actions 和 use API...",
    content: `# React 19 新特性

## Server Components
React 19 引入了 Server Components，允许组件在服务器端渲染...

## Actions
新的 Actions API 简化了表单处理和数据提交...

## use API
use API 提供了更简洁的异步数据获取方式...`,
    date: "2024-01-15",
    tags: ["React", "前端", "教程"],
    path: "/docs/react-19.md",
  },
  {
    id: "2",
    title: "产品需求文档",
    type: "Word 文档",
    preview: "Lumos 资料库产品需求文档，包含核心功能、用户故事和技术架构...",
    content: `产品需求文档

项目名称：Lumos 资料库
版本：v1.0

一、产品概述
Lumos 资料库是一个智能文档管理系统...

二、核心功能
1. 文档导入与管理
2. AI 辅助创作
3. 标签分类
4. 全文搜索`,
    date: "2024-01-14",
    tags: ["产品", "需求"],
    path: "/docs/prd.docx",
  },
  {
    id: "3",
    title: "UI 设计规范",
    type: "PDF 文档",
    preview: "Lumos 的完整 UI 设计规范，包含颜色、字体、组件库等...",
    content: `UI 设计规范

一、颜色系统
主色：#3B82F6
辅助色：#10B981
警告色：#F59E0B

二、字体规范
标题：Inter Bold
正文：Inter Regular

三、组件库
按钮、输入框、卡片等组件的设计规范...`,
    date: "2024-01-13",
    tags: ["设计", "规范"],
    path: "/docs/ui-spec.pdf",
  },
];

export default function CreatePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const itemId = searchParams.get("itemId");

  const [item, setItem] = useState<typeof mockItems[0] | null>(null);
  const [messages, setMessages] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
  const [isStreaming, setIsStreaming] = useState(false);

  useEffect(() => {
    // 根据 itemId 加载资料
    if (itemId) {
      const foundItem = mockItems.find(i => i.id === itemId);
      if (foundItem) {
        setItem(foundItem);
      }
    }
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
                <span>{item.type}</span>
                <span>·</span>
                <span>{item.date}</span>
              </div>
              <div className="flex gap-2 mt-3">
                {item.tags.map(tag => (
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
                {item.content}
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

