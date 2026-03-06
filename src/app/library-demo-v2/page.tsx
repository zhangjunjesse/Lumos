"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { MessageInput } from "@/components/chat/MessageInput";

// Mock 数据
const mockItems = [
  {
    id: "1",
    title: "React 19 新特性",
    type: "Markdown",
    preview: "React 19 引入了多个重要特性，包括 Server Components、Actions 和 use API...",
    date: "2024-01-15",
    tags: ["React", "前端", "教程"],
    path: "/docs/react-19.md",
  },
  {
    id: "2",
    title: "产品需求文档",
    type: "Word 文档",
    preview: "Lumos 资料库产品需求文档，包含核心功能、用户故事和技术架构...",
    date: "2024-01-14",
    tags: ["产品", "需求"],
    path: "/docs/prd.docx",
  },
  {
    id: "3",
    title: "UI 设计规范",
    type: "PDF 文档",
    preview: "Lumos 的完整 UI 设计规范，包含颜色、字体、组件库等...",
    date: "2024-01-13",
    tags: ["设计", "规范"],
    path: "/docs/ui-spec.pdf",
  },
];

// 文件类型 Logo 组件
const FileTypeLogo = ({ type }: { type: string }) => {
  const logos: Record<string, React.ReactElement> = {
    "Markdown": (
      <div className="w-8 h-8 rounded flex items-center justify-center bg-gray-700">
        <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor">
          <path d="M22.27 19.385H1.73A1.73 1.73 0 010 17.655V6.345a1.73 1.73 0 011.73-1.73h20.54A1.73 1.73 0 0124 6.345v11.308a1.73 1.73 0 01-1.73 1.731zM5.769 15.923v-4.5l2.308 2.885 2.307-2.885v4.5h2.308V8.078h-2.308l-2.307 2.885-2.308-2.885H3.46v7.847zM21.232 12h-2.309V8.077h-2.307V12h-2.308l3.461 4.039z"/>
        </svg>
      </div>
    ),
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
  };

  return logos[type] || logos["Word 文档"];
};

export default function LibraryDemoV2Page() {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  // AI 对话状态
  const [messages, setMessages] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
  const [isChatCollapsed, setIsChatCollapsed] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);

  // 收藏状态
  const [favorites, setFavorites] = useState<Set<string>>(new Set());

  // 选中的资料（用于导航到详情页）
  const [selectedItem, setSelectedItem] = useState<typeof mockItems[0] | null>(null);

  // 处理发送消息
  const handleSendMessage = async (content: string) => {
    const userMessage = { role: 'user' as const, content };
    setMessages(prev => [...prev, userMessage]);
    setIsStreaming(true);

    // 模拟 AI 回复
    setTimeout(() => {
      const aiMessage = {
        role: 'assistant' as const,
        content: `关于"${content}"，我在资料库中找到了 ${mockItems.length} 个相关资料。你想了解哪一个的详细内容？`,
      };
      setMessages(prev => [...prev, aiMessage]);
      setIsStreaming(false);
    }, 1000);
  };

  // 切换收藏
  const toggleFavorite = (itemId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setFavorites(prev => {
      const newFavorites = new Set(prev);
      if (newFavorites.has(itemId)) {
        newFavorites.delete(itemId);
      } else {
        newFavorites.add(itemId);
      }
      return newFavorites;
    });
  };

  // 点击资料卡片 - 导航到详情页
  const handleItemClick = (item: typeof mockItems[0]) => {
    setSelectedItem(item);
    // 这里应该使用 router.push，但为了 Demo 我们先用状态切换
  };

  // 如果选中了资料，显示详情页
  if (selectedItem) {
    return (
      <div className="h-screen flex flex-col bg-background">
        {/* 顶部导航栏 */}
        <div className="h-14 border-b border-border flex items-center px-4 gap-3">
          <button
            onClick={() => setSelectedItem(null)}
            className="p-2 rounded-lg hover:bg-accent transition-colors"
            title="返回资料库"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="flex items-center gap-3 flex-1">
            <FileTypeLogo type={selectedItem.type} />
            <div>
              <h1 className="text-sm font-semibold">{selectedItem.title}</h1>
              <p className="text-xs text-muted-foreground">{selectedItem.type} · {selectedItem.date}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={(e) => toggleFavorite(selectedItem.id, e)}
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
          </div>
        </div>

        {/* 主内容区 */}
        <div className="flex-1 flex overflow-hidden">
          {/* 左侧：资料预览 */}
          <div className={`flex-1 overflow-y-auto transition-all duration-300 ${isChatCollapsed ? 'mr-0' : 'mr-80'}`}>
            <div className="max-w-4xl mx-auto p-8">
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <h1>{selectedItem.title}</h1>
                <p className="lead">{selectedItem.preview}</p>

                <h2>详细内容</h2>
                <p>这里是资料的完整内容预览...</p>

                <h3>示例章节</h3>
                <p>Lorem ipsum dolor sit amet, consectetur adipiscing elit...</p>
              </div>
            </div>
          </div>

          {/* 右侧：AI 对话框（可收缩） */}
          <div className={`fixed right-0 top-14 bottom-0 bg-background border-l border-border transition-all duration-300 ${isChatCollapsed ? 'w-12' : 'w-80'}`}>
            {isChatCollapsed ? (
              // 收缩状态
              <button
                onClick={() => setIsChatCollapsed(false)}
                className="w-full h-12 flex items-center justify-center hover:bg-accent transition-colors"
                title="展开 AI 对话"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            ) : (
              // 展开状态
              <div className="h-full flex flex-col">
                {/* 对话框头部 */}
                <div className="h-12 border-b border-border flex items-center justify-between px-4">
                  <div className="flex items-center gap-2">
                    <svg className="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                    </svg>
                    <span className="text-sm font-medium">资料对话</span>
                  </div>
                  <button
                    onClick={() => setIsChatCollapsed(true)}
                    className="p-1 rounded hover:bg-accent transition-colors"
                    title="收起"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                </div>

                {/* 对话消息列表 */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                  {messages.length === 0 ? (
                    <div className="text-center text-sm text-muted-foreground py-8">
                      <p>与这个资料对话</p>
                      <p className="mt-2">问我关于这个资料的任何问题</p>
                    </div>
                  ) : (
                    messages.map((msg, idx) => (
                      <div key={idx} className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[85%] rounded-lg p-3 text-sm ${
                          msg.role === 'user'
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted'
                        }`}>
                          {msg.content}
                        </div>
                      </div>
                    ))
                  )}
                  {isStreaming && (
                    <div className="flex gap-2">
                      <div className="bg-muted rounded-lg p-3 text-sm">
                        <div className="flex gap-1">
                          <span className="w-2 h-2 bg-current rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                          <span className="w-2 h-2 bg-current rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                          <span className="w-2 h-2 bg-current rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* 输入框 */}
                <div className="border-t border-border p-3">
                  <MessageInput
                    onSend={handleSendMessage}
                    isStreaming={isStreaming}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // 资料库主页面
  return (
    <div className="h-screen flex flex-col bg-background">
      {/* 顶部搜索栏 */}
      <div className="h-14 border-b border-border flex items-center px-4 gap-3">
        <div className="flex-1 max-w-2xl">
          <div className="relative">
            <HugeiconsIcon icon={Search} className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="搜索资料..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full h-9 pl-10 pr-4 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
        </div>
      </div>

      {/* 主内容区 */}
      <div className="flex-1 flex overflow-hidden">
        {/* 左侧：资料列表 */}
        <div className={`flex-1 overflow-y-auto transition-all duration-300 ${isChatCollapsed ? 'mr-0' : 'mr-80'}`}>
          <div className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {mockItems.map((item) => (
                <div
                  key={item.id}
                  onClick={() => handleItemClick(item)}
                  className="group p-4 rounded-lg border border-border hover:border-primary hover:shadow-md transition-all cursor-pointer bg-card"
                >
                  <div className="flex items-start gap-3 mb-3">
                    <FileTypeLogo type={item.type} />
                    <div className="flex-1 min-w-0">
                      <h3 className="font-medium text-sm truncate group-hover:text-primary transition-colors">
                        {item.title}
                      </h3>
                      <p className="text-xs text-muted-foreground mt-0.5">{item.type}</p>
                    </div>
                    <button
                      onClick={(e) => toggleFavorite(item.id, e)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity p-1"
                    >
                      {favorites.has(item.id) ? (
                        <svg className="w-4 h-4 text-yellow-500 fill-current" viewBox="0 0 24 24">
                          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                        </svg>
                      )}
                    </button>
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2 mb-3">
                    {item.preview}
                  </p>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{item.date}</span>
                    <div className="flex gap-1">
                      {item.tags.slice(0, 2).map((tag) => (
                        <span key={tag} className="px-2 py-0.5 rounded bg-muted">
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 右侧：AI 对话框（可收缩） */}
        <div className={`fixed right-0 top-14 bottom-0 bg-background border-l border-border transition-all duration-300 ${isChatCollapsed ? 'w-12' : 'w-80'}`}>
          {isChatCollapsed ? (
            // 收缩状态
            <button
              onClick={() => setIsChatCollapsed(false)}
              className="w-full h-12 flex items-center justify-center hover:bg-accent transition-colors"
              title="展开 AI 对话"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          ) : (
            // 展开状态
            <div className="h-full flex flex-col">
              {/* 对话框头部 */}
              <div className="h-12 border-b border-border flex items-center justify-between px-4">
                <div className="flex items-center gap-2">
                  <svg className="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                  </svg>
                  <span className="text-sm font-medium">资料库对话</span>
                </div>
                <button
                  onClick={() => setIsChatCollapsed(true)}
                  className="p-1 rounded hover:bg-accent transition-colors"
                  title="收起"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>

              {/* 对话消息列表 */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {messages.length === 0 ? (
                  <div className="text-center text-sm text-muted-foreground py-8">
                    <p>与资料库对话</p>
                    <p className="mt-2">问我关于资料库的任何问题</p>
                  </div>
                ) : (
                  messages.map((msg, idx) => (
                    <div key={idx} className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[85%] rounded-lg p-3 text-sm ${
                        msg.role === 'user'
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted'
                      }`}>
                        {msg.content}
                      </div>
                    </div>
                  ))
                )}
                {isStreaming && (
                  <div className="flex gap-2">
                    <div className="bg-muted rounded-lg p-3 text-sm">
                      <div className="flex gap-1">
                        <span className="w-2 h-2 bg-current rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                        <span className="w-2 h-2 bg-current rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                        <span className="w-2 h-2 bg-current rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* 输入框 */}
              <div className="border-t border-border p-3">
                <MessageInput
                  onSend={handleSendMessage}
                  isStreaming={isStreaming}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
