"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { MessageInput } from "@/components/chat/MessageInput";

// 类型定义
type PathItem = {
  id: string;
  title: string;
};

type Tag = {
  label: string;
  type: 'custom' | 'ai' | 'system';
  color?: string;
};

type LibraryItem = {
  id: string;
  type: string;
  title: string;
  preview: string;
  path: string;
  timeLabel: string;
  date: string;
  fullDate: string;
  tags: Tag[];
  isDirectory?: boolean;
  children?: LibraryItem[];
};

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
    "文件目录": (
      <div className="w-8 h-8 rounded flex items-center justify-center bg-gradient-to-br from-amber-500 to-orange-600">
        <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
        </svg>
      </div>
    ),
  };

  return logos[type] || logos["Word 文档"];
};

export default function LibraryDemoPage() {
  const router = useRouter();
  const [filter, setFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [showTagSelector, setShowTagSelector] = useState(false);

  // 对话相关状态
  const [messages, setMessages] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
  const [showChat, setShowChat] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);

  // 收藏状态
  const [favorites, setFavorites] = useState<Set<string>>(new Set());

  // 详情页状态
  const [selectedItem, setSelectedItem] = useState<LibraryItem | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState('');

  // 目录导航状态
  const [currentPath, setCurrentPath] = useState<PathItem[]>([]); // 当前路径（面包屑）
  const [currentItems, setCurrentItems] = useState<LibraryItem[]>(mockItems); // 当前显示的项目列表

  const handleSend = (content: string) => {
    // 添加用户消息
    setMessages(prev => [...prev, { role: 'user', content }]);
    setShowChat(true); // 展开对话区
    setIsStreaming(true);

    // 模拟 AI 回复
    setTimeout(() => {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: '这是一个模拟的 AI 回复。在实际应用中，这里会调用 AI API 来生成回复。我可以帮你分析资料库中的内容，回答问题，或者基于这些资料创作新内容。'
      }]);
      setIsStreaming(false);
    }, 1000);
  };

  const clearChat = () => {
    setMessages([]);
    setShowChat(false);
  };

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

  const clearAllTags = () => {
    setSelectedTags([]);
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

  // 进入目录
  const enterDirectory = (item: LibraryItem) => {
    if (item.type === "文件目录" && item.children) {
      // 添加到路径
      setCurrentPath([...currentPath, { id: item.id, title: item.title }]);
      // 更新当前显示的项目列表
      setCurrentItems(item.children);
    }
  };

  // 返回上一级目录
  const goBack = () => {
    if (currentPath.length === 0) return;

    const newPath = currentPath.slice(0, -1);
    setCurrentPath(newPath);

    // 如果回到根目录
    if (newPath.length === 0) {
      setCurrentItems(mockItems);
    } else {
      // 找到父目录的 children
      let items: LibraryItem[] = mockItems;
      for (const pathItem of newPath) {
        const found = items.find((i) => i.id === pathItem.id);
        if (found && found.children) {
          items = found.children;
        }
      }
      setCurrentItems(items);
    }
  };

  // 打开详情页（修改为支持目录导航）
  const openDetail = (item: LibraryItem) => {
    // 如果是目录，进入目录
    if (item.type === "文件目录") {
      enterDirectory(item);
      return;
    }

    // 否则打开详情页
    setSelectedItem(item);
    setShowDetail(true);
    setIsEditing(false);
    setEditContent('');
  };

  // 关闭详情页
  const closeDetail = () => {
    setShowDetail(false);
    setIsEditing(false);
    setTimeout(() => setSelectedItem(null), 300); // 等待动画结束
  };

  // 进入编辑模式
  const enterEditMode = () => {
    if (selectedItem) {
      setIsEditing(true);
      // 根据文件类型设置初始内容
      if (selectedItem.type === 'Markdown') {
        setEditContent(`# ${selectedItem.title}\n\n${selectedItem.preview}\n\n## 更多内容\n\n这里可以继续编辑...`);
      } else {
        setEditContent(selectedItem.preview);
      }
    }
  };

  // 保存编辑
  const saveEdit = () => {
    // 这里应该调用 API 保存
    console.log('保存内容:', editContent);
    setIsEditing(false);
    // 显示保存成功提示
    alert('保存成功！');
  };

  // 取消编辑
  const cancelEdit = () => {
    setIsEditing(false);
    setEditContent('');
  };

  // 基于此创作（跳转到创作页面）
  const createProject = () => {
    if (selectedItem) {
      // 先关闭弹窗
      setShowDetail(false);
      // 跳转到创作页面，传递资料 ID
      router.push(`/library-demo/create?itemId=${selectedItem.id}`);
    }
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

  // 过滤逻辑
  const filteredItems = currentItems.filter((item) => {
    // 类型筛选
    const typeMatch = (() => {
      if (filter === "all") return true;
      if (filter === "documents") {
        return ["Word 文档", "PDF 文档", "PowerPoint", "Excel 表格", "Markdown", "飞书文档", "Google Docs", "Notion", "语雀文档"].includes(item.type);
      }
      if (filter === "conversations") {
        return item.type === "AI 对话";
      }
      if (filter === "audio") {
        return ["MP3 音频", "iPhone 录音", "WAV 音频", "AAC 音频", "FLAC 音频"].includes(item.type);
      }
      if (filter === "video") {
        return ["MP4 视频", "MOV 视频", "AVI 视频", "MKV 视频"].includes(item.type);
      }
      if (filter === "web") {
        return item.type === "网页";
      }
      return true;
    })();

    if (!typeMatch) return false;

    // 标签筛选（包含任意一个选中的标签即可 - OR 逻辑）
    if (selectedTags.length > 0) {
      const itemTagLabels = item.tags?.map(tag => tag.label) || [];
      const hasAnyTag = selectedTags.some(selectedTag =>
        itemTagLabels.includes(selectedTag)
      );
      if (!hasAnyTag) return false;
    }

    // 搜索过滤
    if (!searchQuery.trim()) return true;

    const query = searchQuery.toLowerCase();
    const titleMatch = item.title.toLowerCase().includes(query);
    const previewMatch = item.preview.toLowerCase().includes(query);
    const tagMatch = item.tags?.some(tag => tag.label.toLowerCase().includes(query));

    return titleMatch || previewMatch || tagMatch;
  });

  // 收集所有标签及其使用次数
  const allTags = mockItems.reduce((acc, item) => {
    item.tags?.forEach(tag => {
      if (acc[tag.label]) {
        acc[tag.label].count++;
      } else {
        acc[tag.label] = {
          label: tag.label,
          type: tag.type,
          color: tag.color,
          count: 1,
        };
      }
    });
    return acc;
  }, {} as Record<string, { label: string; type: string; color?: string; count: number }>);

  // 转换为数组并按使用次数排序
  const sortedTags = Object.values(allTags).sort((a, b) => b.count - a.count);

  return (
    <div className="flex h-full flex-col bg-background">
      {/* 主内容区 */}
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-6xl px-8 py-8 space-y-6">

          {/* 筛选栏 */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FilterButton active={filter === "all"} onClick={() => setFilter("all")}>
                全部
              </FilterButton>
              <FilterButton active={filter === "documents"} onClick={() => setFilter("documents")}>
                📄 文档
              </FilterButton>
              <FilterButton active={filter === "conversations"} onClick={() => setFilter("conversations")}>
                💬 对话
              </FilterButton>
              <FilterButton active={filter === "audio"} onClick={() => setFilter("audio")}>
                🎵 音频
              </FilterButton>
              <FilterButton active={filter === "video"} onClick={() => setFilter("video")}>
                🎬 视频
              </FilterButton>
              <FilterButton active={filter === "web"} onClick={() => setFilter("web")}>
                🌐 网页
              </FilterButton>
            </div>

            <div className="flex items-center gap-3">
              <div className="relative">
                <HugeiconsIcon icon={Search01Icon} className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="搜索资料..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 pr-4 py-2 rounded-lg border border-border bg-background text-sm outline-none focus:border-primary/50 transition-colors w-64"
                />
              </div>
            </div>
          </div>

          {/* 标签筛选区 */}
          <div className="flex items-center gap-2 flex-wrap">
            {selectedTags.length > 0 && (
              <>
                <span className="text-sm text-muted-foreground">筛选标签:</span>
                {selectedTags.map((tag) => (
                  <button
                    key={tag}
                    onClick={() => removeTag(tag)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                  >
                    {tag}
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                ))}
                {selectedTags.length > 1 && (
                  <button
                    onClick={clearAllTags}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors underline"
                  >
                    清除全部
                  </button>
                )}
              </>
            )}

            {/* 添加标签按钮 */}
            <div className="relative">
              <button
                onClick={() => setShowTagSelector(!showTagSelector)}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium border border-dashed border-border hover:border-primary/50 hover:bg-accent transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                添加标签
              </button>

              {/* 标签选择器下拉面板 */}
              {showTagSelector && (
                <>
                  {/* 遮罩层 */}
                  <div
                    className="fixed inset-0 z-10"
                    onClick={() => setShowTagSelector(false)}
                  />

                  {/* 下拉面板 */}
                  <div className="absolute top-full left-0 mt-2 w-96 max-h-80 overflow-auto bg-popover border border-border rounded-lg shadow-lg z-20 p-3">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between px-1">
                        <span className="text-xs font-medium text-muted-foreground">选择标签</span>
                        <span className="text-xs text-muted-foreground">{sortedTags.length} 个标签</span>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        {sortedTags.map((tag) => {
                          const isSelected = selectedTags.includes(tag.label);
                          const getTagStyle = () => {
                            if (tag.type === 'custom') {
                              const colors: Record<string, string> = {
                                red: 'bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-500/20',
                                orange: 'bg-orange-500/10 text-orange-600 dark:text-orange-400 hover:bg-orange-500/20',
                                yellow: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 hover:bg-yellow-500/20',
                                green: 'bg-green-500/10 text-green-600 dark:text-green-400 hover:bg-green-500/20',
                                blue: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20',
                                purple: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 hover:bg-purple-500/20',
                              };
                              return colors[tag.color || 'blue'] || colors.blue;
                            } else if (tag.type === 'ai') {
                              return 'border border-blue-500/50 text-blue-600 dark:text-blue-400 bg-transparent hover:bg-blue-500/10';
                            } else {
                              return 'bg-gray-500/10 text-gray-600 dark:text-gray-400 hover:bg-gray-500/20';
                            }
                          };

                          return (
                            <button
                              key={tag.label}
                              onClick={() => handleTagClick(tag.label)}
                              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-all ${
                                isSelected ? 'ring-2 ring-primary ring-offset-1 ring-offset-popover' : ''
                              } ${getTagStyle()}`}
                            >
                              {tag.label}
                              <span className="text-[10px] opacity-60">({tag.count})</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* 搜索结果计数 */}
          {(searchQuery || filter !== "all" || selectedTags.length > 0) && (
            <div className="text-sm text-muted-foreground">
              找到 <span className="font-medium text-foreground">{filteredItems.length}</span> 条结果
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
                    setCurrentItems(mockItems);
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
          <div className="grid grid-cols-3 gap-4">
            {filteredItems.length > 0 ? (
              filteredItems.map((item) => (
                <ContentCard
                  key={item.id}
                  item={item}
                  onTagClick={handleTagClick}
                  selectedTags={selectedTags}
                  isFavorite={favorites.has(item.id)}
                  onToggleFavorite={toggleFavorite}
                  onClick={openDetail}
                />
              ))
            ) : (
              <div className="col-span-3 flex flex-col items-center justify-center py-16 text-center">
                <div className="text-4xl mb-4">🔍</div>
                <h3 className="text-lg font-medium text-foreground mb-2">未找到相关资料</h3>
                <p className="text-sm text-muted-foreground">
                  {searchQuery ? `没有找到包含"${searchQuery}"的资料` : "该分类下暂无资料"}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 底部 AI 对话框 */}
      <div className="border-t border-border/50 bg-background">
        <div className="mx-auto max-w-4xl px-4">
          {/* 对话记录区域 */}
          {showChat && messages.length > 0 && (
            <div className="border-b border-border/50">
              <div className="flex items-center justify-between py-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">对话记录</span>
                  <span className="text-xs text-muted-foreground">({messages.length} 条消息)</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={clearChat}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    清空对话
                  </button>
                  <button
                    onClick={() => setShowChat(false)}
                    className="p-1 rounded hover:bg-accent transition-colors"
                    title="折叠对话"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* 消息列表 */}
              <div className="max-h-96 overflow-y-auto pb-4 space-y-4">
                {messages.map((message, index) => (
                  <div
                    key={index}
                    className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[80%] rounded-lg px-4 py-2.5 ${
                        message.role === 'user'
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted text-foreground'
                      }`}
                    >
                      <div className="text-sm whitespace-pre-wrap">{message.content}</div>
                    </div>
                  </div>
                ))}
                {isStreaming && (
                  <div className="flex justify-start">
                    <div className="max-w-[80%] rounded-lg px-4 py-2.5 bg-muted">
                      <div className="flex items-center gap-1">
                        <div className="w-2 h-2 rounded-full bg-foreground/40 animate-bounce" style={{ animationDelay: '0ms' }} />
                        <div className="w-2 h-2 rounded-full bg-foreground/40 animate-bounce" style={{ animationDelay: '150ms' }} />
                        <div className="w-2 h-2 rounded-full bg-foreground/40 animate-bounce" style={{ animationDelay: '300ms' }} />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 输入框 */}
          <div className="py-4">
            {!showChat && messages.length > 0 && (
              <button
                onClick={() => setShowChat(true)}
                className="mb-3 text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                </svg>
                展开对话记录 ({messages.length} 条消息)
              </button>
            )}
            <MessageInput
              onSend={handleSend}
              disabled={false}
              isStreaming={isStreaming}
            />
          </div>
        </div>
      </div>

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
                </div>
              </div>
              <div className="flex items-center gap-2">
                {/* 基于此创作按钮 */}
                <button
                  onClick={createProject}
                  className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors flex items-center gap-2"
                  title="基于此创作"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  基于此创作
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
                      💾 自动保存于 2 分钟前
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
                <>
              {/* 根据文件类型渲染不同的预览 */}
              {(() => {
                const type = selectedItem.type;

                // Markdown 文件
                if (type === "Markdown") {
                  return (
                    <div className="prose prose-sm dark:prose-invert max-w-none mb-6">
                      <h2>React 19 新特性</h2>
                      <p className="lead">{selectedItem.preview}</p>

                      <h3>1. Server Components</h3>
                      <p>React Server Components 允许你在服务器端渲染组件，减少客户端 JavaScript 的体积。</p>
                      <pre><code>{`// app/page.tsx
export default async function Page() {
  const data = await fetch('https://api.example.com/data');
  return <div>{data.title}</div>;
}`}</code></pre>

                      <h3>2. Actions</h3>
                      <p>Actions 提供了一种新的方式来处理表单提交和数据变更。</p>
                      <pre><code>{`'use server'

async function createPost(formData: FormData) {
  const title = formData.get('title');
  // 保存到数据库
}`}</code></pre>

                      <h3>3. use API</h3>
                      <p>新的 use Hook 可以在组件中读取 Promise 或 Context。</p>
                      <pre><code>{`function Component() {
  const data = use(fetchData());
  return <div>{data}</div>;
}`}</code></pre>
                    </div>
                  );
                }

                // PDF 文档
                if (type === "PDF 文档") {
                  return (
                    <div className="mb-6">
                      <div className="bg-muted/30 rounded-lg p-8 text-center">
                        <svg className="w-16 h-16 mx-auto mb-4 text-red-500" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zM6 20V4h7v5h5v11H6zm2-2h8v-2H8v2zm0-4h8v-2H8v2zm0-4h5V8H8v2z"/>
                        </svg>
                        <h3 className="text-lg font-semibold mb-2">PDF 文档预览</h3>
                        <p className="text-sm text-muted-foreground mb-4">{selectedItem.preview}</p>
                        <div className="flex items-center justify-center gap-2">
                          <button className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90">
                            打开 PDF
                          </button>
                          <button className="px-4 py-2 bg-muted text-foreground rounded-lg text-sm font-medium hover:bg-muted/80">
                            下载
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                }

                // Word 文档
                if (type === "Word 文档") {
                  return (
                    <div className="prose prose-sm dark:prose-invert max-w-none mb-6">
                      <h2>{selectedItem.title}</h2>
                      <p className="lead">{selectedItem.preview}</p>

                      <h3>一、项目背景</h3>
                      <p>随着 AI 技术的快速发展，用户对知识管理工具的需求也在不断演进。传统的笔记软件已经无法满足用户对智能化、个性化的需求。Lumos 资料库旨在打造一个 AI 原生的知识管理平台。</p>

                      <h3>二、核心功能</h3>
                      <ul>
                        <li><strong>智能分类</strong>：AI 自动分析内容并打标签</li>
                        <li><strong>语义搜索</strong>：基于向量检索的智能搜索</li>
                        <li><strong>AI 对话</strong>：与资料库内容进行对话</li>
                        <li><strong>知识图谱</strong>：自动构建内容之间的关联</li>
                      </ul>

                      <h3>三、技术架构</h3>
                      <p>前端采用 Next.js + React 19，后端使用 Node.js + PostgreSQL，向量检索使用 Pinecone。</p>
                    </div>
                  );
                }

                // AI 对话
                if (type === "AI 对话") {
                  return (
                    <div className="mb-6 space-y-4">
                      <div className="flex gap-3">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center flex-shrink-0">
                          <span className="text-white text-xs font-bold">我</span>
                        </div>
                        <div className="flex-1 bg-primary/10 rounded-lg rounded-tl-none p-4">
                          <p className="text-sm">我想设计一个资料库页面，应该采用什么样的布局和交互方式？</p>
                        </div>
                      </div>

                      <div className="flex gap-3">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center flex-shrink-0">
                          <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                          </svg>
                        </div>
                        <div className="flex-1 bg-muted rounded-lg rounded-tl-none p-4">
                          <div className="prose prose-sm dark:prose-invert max-w-none">
                            <p>对于资料库页面，我建议采用<strong>卡片网格布局</strong>，原因如下：</p>
                            <ol>
                              <li><strong>视觉扫描效率高</strong>：卡片布局让用户可以快速浏览大量内容</li>
                              <li><strong>信息层次清晰</strong>：每张卡片包含标题、预览、标签等关键信息</li>
                              <li><strong>响应式友好</strong>：可以根据屏幕宽度自动调整列数</li>
                            </ol>
                            <p>具体建议：</p>
                            <ul>
                              <li>桌面端：3 列网格</li>
                              <li>平板：2 列网格</li>
                              <li>手机：1 列列表</li>
                            </ul>
                          </div>
                        </div>
                      </div>

                      <div className="flex gap-3">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center flex-shrink-0">
                          <span className="text-white text-xs font-bold">我</span>
                        </div>
                        <div className="flex-1 bg-primary/10 rounded-lg rounded-tl-none p-4">
                          <p className="text-sm">那色彩方案呢？应该用什么样的配色？</p>
                        </div>
                      </div>

                      <div className="flex gap-3">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center flex-shrink-0">
                          <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                          </svg>
                        </div>
                        <div className="flex-1 bg-muted rounded-lg rounded-tl-none p-4">
                          <div className="prose prose-sm dark:prose-invert max-w-none">
                            <p>建议采用<strong>极简主义</strong>的配色方案，参考乔布斯的设计哲学：</p>
                            <ul>
                              <li><strong>主色调</strong>：使用单一的品牌色（如蓝色）</li>
                              <li><strong>背景</strong>：纯白或浅灰，营造干净的视觉空间</li>
                              <li><strong>文字</strong>：深灰色而非纯黑，减少视觉疲劳</li>
                              <li><strong>强调色</strong>：用于重要操作按钮和状态提示</li>
                            </ul>
                            <p>避免使用过多颜色，保持整体的统一性和专业感。</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                }

                // 网页
                if (type === "网页") {
                  return (
                    <div className="prose prose-sm dark:prose-invert max-w-none mb-6">
                      <div className="not-prose bg-muted/30 rounded-lg p-4 mb-4 flex items-center gap-3">
                        <svg className="w-5 h-5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                        </svg>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-muted-foreground truncate">{selectedItem.path}</p>
                        </div>
                        <button className="text-xs text-primary hover:underline">访问原网页</button>
                      </div>

                      <h2>{selectedItem.title}</h2>
                      <p className="lead">{selectedItem.preview}</p>

                      <p>这是从网页中提取的主要内容。原始网页包含了更多的交互元素和样式，建议访问原网页查看完整内容。</p>

                      <h3>主要内容摘要</h3>
                      <ul>
                        <li>介绍了最新的技术趋势和发展方向</li>
                        <li>提供了详细的代码示例和最佳实践</li>
                        <li>包含了社区讨论和用户反馈</li>
                      </ul>
                    </div>
                  );
                }

                // 音频文件
                if (type.includes("音频") || type.includes("录音")) {
                  return (
                    <div className="mb-6">
                      <div className="bg-gradient-to-br from-purple-500/10 to-pink-500/10 rounded-lg p-8">
                        <div className="flex items-center gap-4 mb-6">
                          <div className="w-20 h-20 rounded-lg bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center flex-shrink-0">
                            <svg className="w-10 h-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                            </svg>
                          </div>
                          <div className="flex-1">
                            <h3 className="font-semibold mb-1">{selectedItem.title}</h3>
                            <p className="text-sm text-muted-foreground">时长: 45:32</p>
                          </div>
                        </div>

                        {/* 音频播放器 */}
                        <div className="bg-background/50 rounded-lg p-4">
                          <div className="flex items-center gap-4 mb-3">
                            <button className="w-12 h-12 rounded-full bg-primary text-primary-foreground flex items-center justify-center hover:bg-primary/90 transition-colors">
                              <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                                <path d="M8 5v14l11-7z"/>
                              </svg>
                            </button>
                            <div className="flex-1">
                              <div className="h-1 bg-muted rounded-full overflow-hidden">
                                <div className="h-full w-1/3 bg-primary"></div>
                              </div>
                              <div className="flex justify-between text-xs text-muted-foreground mt-1">
                                <span>15:24</span>
                                <span>45:32</span>
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className="mt-4 prose prose-sm dark:prose-invert max-w-none">
                          <p className="text-sm">{selectedItem.preview}</p>
                        </div>
                      </div>
                    </div>
                  );
                }

                // 视频文件
                if (type.includes("视频")) {
                  return (
                    <div className="mb-6">
                      <div className="bg-black rounded-lg overflow-hidden mb-4">
                        <div className="aspect-video bg-gradient-to-br from-gray-800 to-gray-900 flex items-center justify-center">
                          <button className="w-20 h-20 rounded-full bg-white/20 backdrop-blur flex items-center justify-center hover:bg-white/30 transition-colors">
                            <svg className="w-10 h-10 text-white ml-1" fill="currentColor" viewBox="0 0 24 24">
                              <path d="M8 5v14l11-7z"/>
                            </svg>
                          </button>
                        </div>
                      </div>
                      <div className="prose prose-sm dark:prose-invert max-w-none">
                        <h3>{selectedItem.title}</h3>
                        <p>{selectedItem.preview}</p>
                        <div className="not-prose flex items-center gap-4 text-sm text-muted-foreground">
                          <span>时长: 12:45</span>
                          <span>•</span>
                          <span>分辨率: 1920x1080</span>
                          <span>•</span>
                          <span>大小: 156 MB</span>
                        </div>
                      </div>
                    </div>
                  );
                }

                // 默认：显示预览文本
                return (
                  <div className="prose prose-sm dark:prose-invert max-w-none mb-6">
                    <p className="text-base leading-relaxed">{selectedItem.preview}</p>
                    <p className="text-sm text-muted-foreground mt-4">
                      这是内容的预览摘要。完整内容需要在编辑模式下查看。
                    </p>
                  </div>
                );
              })()}
              </>
              )}

              {/* 路径信息 */}
              {selectedItem.path && (
                <div className="mb-6 p-4 rounded-lg bg-muted/50">
                  <div className="flex items-center gap-2 text-sm">
                    <svg className="w-4 h-4 text-muted-foreground flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                    </svg>
                    <span className="text-muted-foreground font-mono text-xs break-all">{selectedItem.path}</span>
                  </div>
                </div>
              )}

              {/* 标签 */}
              {selectedItem.tags && selectedItem.tags.length > 0 && (
                <div className="mb-6">
                  <h3 className="text-sm font-medium mb-3">标签</h3>
                  <div className="flex items-center gap-2 flex-wrap">
                    {selectedItem.tags.map((tag, index) => {
                      const getTagStyle = () => {
                        if (tag.type === 'custom') {
                          const colors: Record<string, string> = {
                            red: 'bg-red-500/10 text-red-600 dark:text-red-400',
                            orange: 'bg-orange-500/10 text-orange-600 dark:text-orange-400',
                            yellow: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400',
                            green: 'bg-green-500/10 text-green-600 dark:text-green-400',
                            blue: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
                            purple: 'bg-purple-500/10 text-purple-600 dark:text-purple-400',
                          };
                          return colors[tag.color || 'blue'] || colors.blue;
                        } else if (tag.type === 'ai') {
                          return 'border border-blue-500/50 text-blue-600 dark:text-blue-400 bg-transparent';
                        } else {
                          return 'bg-gray-500/10 text-gray-600 dark:text-gray-400';
                        }
                      };
                      return (
                        <span
                          key={index}
                          className={`inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium ${getTagStyle()}`}
                        >
                          {tag.label}
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 元信息 */}
              <div className="border-t border-border pt-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">类型</span>
                    <p className="font-medium mt-1">{selectedItem.type}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">{selectedItem.timeLabel}</span>
                    <p className="font-medium mt-1">{selectedItem.fullDate}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* 底部操作栏 */}
            <div className="sticky bottom-0 flex items-center justify-end gap-2 px-6 py-4 border-t border-border bg-background/95 backdrop-blur">
              <button className="px-4 py-2 rounded-lg text-sm font-medium hover:bg-accent transition-colors">
                分享
              </button>
              <button className="px-4 py-2 rounded-lg text-sm font-medium hover:bg-accent transition-colors">
                导出
              </button>
              <button className="px-4 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">
                编辑
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FilterButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
        active
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:bg-accent"
      }`}
    >
      {children}
    </button>
  );
}

function ContentCard({
  item,
  onTagClick,
  selectedTags,
  isFavorite,
  onToggleFavorite,
  onClick
}: {
  item: typeof mockItems[0];
  onTagClick: (tagLabel: string) => void;
  selectedTags: string[];
  isFavorite: boolean;
  onToggleFavorite: (id: string, e: React.MouseEvent) => void;
  onClick: (item: typeof mockItems[0]) => void;
}) {
  // 标签最多显示3个
  const visibleTags = item.tags?.slice(0, 3) || [];
  const remainingCount = (item.tags?.length || 0) - visibleTags.length;

  // 根据标签类型返回样式
  const getTagStyle = (tag: Tag) => {
    if (tag.type === 'custom') {
      // 自定义标签：彩色背景
      const colors: Record<string, string> = {
        red: 'bg-red-500/10 text-red-600 dark:text-red-400',
        orange: 'bg-orange-500/10 text-orange-600 dark:text-orange-400',
        yellow: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400',
        green: 'bg-green-500/10 text-green-600 dark:text-green-400',
        blue: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
        purple: 'bg-purple-500/10 text-purple-600 dark:text-purple-400',
      };
      return colors[tag.color || 'blue'] || colors.blue;
    } else if (tag.type === 'ai') {
      // AI标签：蓝色边框
      return 'border border-blue-500/50 text-blue-600 dark:text-blue-400 bg-transparent';
    } else {
      // 系统标签：灰色
      return 'bg-gray-500/10 text-gray-600 dark:text-gray-400';
    }
  };

  return (
    <div
      onClick={() => onClick(item)}
      className="group relative rounded-xl border border-border bg-card p-5 hover:border-primary/50 hover:shadow-lg hover:scale-[1.02] transition-all cursor-pointer"
    >
      {/* 收藏按钮 */}
      <button
        onClick={(e) => onToggleFavorite(item.id, e)}
        className="absolute top-3 right-3 p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-accent transition-all z-10"
        title={isFavorite ? "取消收藏" : "收藏"}
      >
        {isFavorite ? (
          <svg className="w-5 h-5 text-yellow-500 fill-current" viewBox="0 0 24 24">
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
          </svg>
        ) : (
          <svg className="w-5 h-5 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
          </svg>
        )}
      </button>

      <div className="space-y-3">
        {/* 文件类型 Logo 和标题 */}
        <div className="flex items-start gap-3">
          <FileTypeLogo type={item.type} />
          <div className="flex-1 min-w-0">
            <h3 className="font-medium text-sm line-clamp-2 mb-2">{item.title}</h3>
            <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">{item.preview}</p>
          </div>
        </div>

        {/* 路径信息 */}
        {item.path && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground/70">
            <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
            <span className="truncate" title={item.path}>{item.path}</span>
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
                  } ${getTagStyle(tag)}`}
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
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">{item.type}</span>
          <span className="text-muted-foreground" title={item.fullDate}>
            {item.timeLabel} {item.date}
          </span>
        </div>
      </div>

      {/* 悬停操作按钮 */}
      <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
        <button className="p-1.5 rounded-md bg-background/80 backdrop-blur-sm border border-border hover:bg-accent transition-colors" title="查看详情">
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
        </button>
        <button className="p-1.5 rounded-md bg-background/80 backdrop-blur-sm border border-border hover:bg-accent transition-colors" title="添加标签">
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
          </svg>
        </button>
        <button className="p-1.5 rounded-md bg-background/80 backdrop-blur-sm border border-border hover:bg-accent transition-colors" title="更多操作">
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h.01M12 12h.01M19 12h.01M6 12a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0z" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// 模拟数据
const mockItems: LibraryItem[] = [
  {
    id: "dir_1",
    type: "文件目录",
    title: "Lumos 项目文档",
    preview: "包含 15 个文件和 3 个子目录，涵盖产品需求、设计规范、技术文档等核心资料",
    path: "/Users/zhangjun/Projects/lumos/docs",
    timeLabel: "最后更新",
    date: "1 小时前",
    fullDate: "2024-01-15 15:00",
    tags: [
      { label: "项目", type: "custom", color: "blue" },
      { label: "文档", type: "ai" },
    ],
    // 文件目录特有字段
    isDirectory: true,
    children: [
      {
        id: "dir_1_1",
        type: "文件目录",
        title: "产品需求",
        preview: "包含 5 个需求文档",
        path: "/Users/zhangjun/Projects/lumos/docs/产品需求",
        timeLabel: "最后更新",
        date: "2 小时前",
        fullDate: "2024-01-15 14:00",
        tags: [{ label: "需求", type: "custom", color: "green" }],
        isDirectory: true,
        children: [
          {
            id: "dir_1_1_1",
            type: "Word 文档",
            title: "产品需求文档 - Lumos 资料库设计",
            preview: "本文档描述了 Lumos 资料库的核心功能和设计理念...",
            path: "/Users/zhangjun/Projects/lumos/docs/产品需求/PRD-资料库.docx",
            timeLabel: "最后编辑",
            date: "2 小时前",
            fullDate: "2024-01-15 14:30",
            tags: [{ label: "产品", type: "custom", color: "blue" }],
          },
          {
            id: "dir_1_1_2",
            type: "PDF 文档",
            title: "用户故事地图",
            preview: "详细的用户故事和使用场景分析...",
            path: "/Users/zhangjun/Projects/lumos/docs/产品需求/用户故事地图.pdf",
            timeLabel: "最后编辑",
            date: "3 小时前",
            fullDate: "2024-01-15 13:00",
            tags: [{ label: "用户研究", type: "ai" }],
          },
        ],
      },
      {
        id: "dir_1_2",
        type: "文件目录",
        title: "设计规范",
        preview: "包含 3 个设计文档",
        path: "/Users/zhangjun/Projects/lumos/docs/设计规范",
        timeLabel: "最后更新",
        date: "5 小时前",
        fullDate: "2024-01-15 11:00",
        tags: [{ label: "设计", type: "custom", color: "orange" }],
        isDirectory: true,
        children: [
          {
            id: "dir_1_2_1",
            type: "PDF 文档",
            title: "UI 设计规范",
            preview: "Lumos 的完整 UI 设计规范，包含颜色、字体、组件库等...",
            path: "/Users/zhangjun/Projects/lumos/docs/设计规范/UI设计规范.pdf",
            timeLabel: "最后编辑",
            date: "5 小时前",
            fullDate: "2024-01-15 11:00",
            tags: [{ label: "UI", type: "ai" }],
          },
        ],
      },
      {
        id: "dir_1_3",
        type: "Markdown",
        title: "技术架构文档",
        preview: "Lumos 采用 Electron + Next.js 架构...",
        path: "/Users/zhangjun/Projects/lumos/docs/architecture.md",
        timeLabel: "最后编辑",
        date: "1 周前",
        fullDate: "2024-01-08 09:15",
        tags: [{ label: "技术", type: "custom", color: "blue" }],
      },
    ],
  },
  {
    id: "1",
    type: "Word 文档",
    title: "产品需求文档 - Lumos 资料库设计",
    preview: "本文档描述了 Lumos 资料库的核心功能和设计理念，包括 AI 创作入口、内容管理、知识库集成等核心模块的详细说明...",
    path: "/Users/zhangjun/Documents/产品需求文档-Lumos资料库设计.docx",
    timeLabel: "最后编辑",
    date: "2 小时前",
    fullDate: "2024-01-15 14:30",
    tags: [
      { label: "产品", type: "custom", color: "blue" },
      { label: "重要", type: "custom", color: "red" },
      { label: "Lumos", type: "custom", color: "purple" },
      { label: "需求文档", type: "ai" },
    ],
  },
  {
    id: "2",
    type: "AI 对话",
    title: "与 Claude 讨论 UI 设计方案",
    preview: "讨论了资料库页面的布局、色彩方案和交互细节，确定了乔布斯式的极简美学方向，并提出了具体的实现建议...",
    path: "lumos://conversations/conv_abc123",
    timeLabel: "创建于",
    date: "5 小时前",
    fullDate: "2024-01-15 11:00",
    tags: [
      { label: "设计", type: "custom", color: "orange" },
      { label: "UI/UX", type: "ai" },
      { label: "对话", type: "system" },
    ],
  },
  {
    id: "3",
    type: "PDF 文档",
    title: "2024 年度产品规划",
    preview: "详细规划了 Lumos 在 2024 年的产品路线图，包括 Q1-Q4 的核心功能迭代、市场策略和团队扩张计划...",
    path: "/Users/zhangjun/Documents/2024年度产品规划.pdf",
    timeLabel: "最后编辑",
    date: "昨天",
    fullDate: "2024-01-14 16:20",
    tags: [
      { label: "规划", type: "custom", color: "green" },
      { label: "产品", type: "custom", color: "blue" },
      { label: "2024", type: "ai" },
      { label: "战略", type: "ai" },
    ],
  },
  {
    id: "4",
    type: "PowerPoint",
    title: "产品发布会演示文稿",
    preview: "Lumos 2.0 产品发布会的完整演示文稿，包括产品介绍、核心功能演示、竞品对比和未来规划等内容...",
    path: "/Users/zhangjun/Documents/产品发布会演示文稿.pptx",
    timeLabel: "最后编辑",
    date: "2 天前",
    fullDate: "2024-01-13 10:00",
    tags: [
      { label: "演示", type: "custom", color: "orange" },
      { label: "发布会", type: "ai" },
    ],
  },
  {
    id: "5",
    type: "Excel 表格",
    title: "用户反馈数据分析",
    preview: "收集了 500+ 用户的反馈数据，包括功能使用频率、满意度评分、改进建议等，为产品优化提供数据支持...",
    path: "/Users/zhangjun/Documents/用户反馈数据分析.xlsx",
    timeLabel: "最后编辑",
    date: "3 天前",
    fullDate: "2024-01-12 15:30",
    tags: [
      { label: "数据分析", type: "custom", color: "green" },
      { label: "用户研究", type: "ai" },
      { label: "反馈", type: "ai" },
    ],
  },
  {
    id: "6",
    type: "Markdown",
    title: "技术架构文档",
    preview: "Lumos 采用 Electron + Next.js 架构，使用 SQLite 作为本地数据库，支持多模型 AI 对话和飞书文档集成...",
    path: "/Users/zhangjun/Projects/lumos/docs/architecture.md",
    timeLabel: "最后编辑",
    date: "1 周前",
    fullDate: "2024-01-08 09:15",
    tags: [
      { label: "技术", type: "custom", color: "blue" },
      { label: "架构", type: "ai" },
      { label: "文档", type: "system" },
    ],
  },
  {
    id: "7",
    type: "MP3 音频",
    title: "产品会议录音 - 2024-01-15",
    preview: "讨论了产品路线图和下一阶段的开发计划，包括知识库功能、Tiptap 编辑器集成等重要议题...",
    path: "/Users/zhangjun/Recordings/产品会议录音-20240115.mp3",
    timeLabel: "录制于",
    date: "1 周前",
    fullDate: "2024-01-08 10:00",
    tags: [
      { label: "会议", type: "custom", color: "blue" },
      { label: "录音", type: "system" },
      { label: "产品规划", type: "ai" },
    ],
  },
  {
    id: "8",
    type: "iPhone 录音",
    title: "用户访谈录音 - 张三",
    preview: "与用户张三的深度访谈,了解他在知识管理方面的痛点和需求，为产品设计提供了重要参考...",
    path: "icloud://voice-memos/recording_20240108_142000.m4a",
    timeLabel: "录制于",
    date: "1 周前",
    fullDate: "2024-01-08 14:20",
    tags: [
      { label: "用户研究", type: "custom", color: "green" },
      { label: "访谈", type: "ai" },
      { label: "iPhone", type: "system" },
    ],
  },
  {
    id: "9",
    type: "WAV 音频",
    title: "产品 Kickoff 会议录音",
    preview: "Lumos 项目启动会议录音，讨论了产品愿景、核心功能、技术架构和团队分工等重要议题...",
    path: "/Users/zhangjun/Recordings/产品Kickoff会议.wav",
    timeLabel: "录制于",
    date: "2 周前",
    fullDate: "2024-01-01 09:30",
    tags: [
      { label: "Kickoff", type: "custom", color: "purple" },
      { label: "重要", type: "custom", color: "red" },
      { label: "会议", type: "ai" },
    ],
  },
  {
    id: "10",
    type: "AAC 音频",
    title: "播客录制 - AI 时代的知识管理",
    preview: "探讨了在 AI 时代，个人和团队应该如何进行知识管理，分享了 Lumos 的设计理念和实践经验...",
    path: "/Users/zhangjun/Podcasts/AI时代的知识管理.aac",
    timeLabel: "录制于",
    date: "2 周前",
    fullDate: "2024-01-01 15:00",
    tags: [
      { label: "播客", type: "custom", color: "orange" },
      { label: "AI", type: "ai" },
      { label: "知识管理", type: "ai" },
    ],
  },
  {
    id: "11",
    type: "FLAC 音频",
    title: "音乐素材 - 产品演示背景音乐",
    preview: "为产品演示视频准备的背景音乐，采用无损 FLAC 格式，确保音质完美...",
    path: "/Users/zhangjun/Music/产品演示背景音乐.flac",
    timeLabel: "添加于",
    date: "2 周前",
    fullDate: "2024-01-01 11:00",
    tags: [
      { label: "音乐", type: "custom", color: "purple" },
      { label: "素材", type: "ai" },
    ],
  },
  {
    id: "12",
    type: "MP4 视频",
    title: "Lumos 产品演示视频",
    preview: "展示了 Lumos 的核心功能和使用场景，包括 AI 对话、文档管理、飞书集成等主要特性的实际操作演示...",
    path: "/Users/zhangjun/Videos/Lumos产品演示.mp4",
    timeLabel: "创建于",
    date: "3 周前",
    fullDate: "2023-12-25 16:00",
    tags: [
      { label: "演示", type: "custom", color: "orange" },
      { label: "产品", type: "custom", color: "blue" },
      { label: "视频", type: "system" },
    ],
  },
  {
    id: "13",
    type: "MOV 视频",
    title: "iPhone 拍摄 - 团队 Offsite 活动",
    preview: "记录了团队 Offsite 活动的精彩瞬间，包括团建游戏、产品讨论和晚宴等环节...",
    path: "icloud://photos/IMG_20231225_100000.MOV",
    timeLabel: "拍摄于",
    date: "3 周前",
    fullDate: "2023-12-25 10:00",
    tags: [
      { label: "团队", type: "custom", color: "green" },
      { label: "Offsite", type: "ai" },
      { label: "iPhone", type: "system" },
    ],
  },
  {
    id: "14",
    type: "AVI 视频",
    title: "竞品分析 - Notion 功能演示",
    preview: "详细演示了 Notion 的核心功能和交互设计，分析其优缺点，为 Lumos 的产品设计提供借鉴...",
    path: "/Users/zhangjun/Videos/竞品分析-Notion.avi",
    timeLabel: "创建于",
    date: "3 周前",
    fullDate: "2023-12-24 14:00",
    tags: [
      { label: "竞品分析", type: "custom", color: "purple" },
      { label: "Notion", type: "ai" },
      { label: "研究", type: "ai" },
    ],
  },
  {
    id: "15",
    type: "MKV 视频",
    title: "设计系统演示视频",
    preview: "展示了 Lumos 的设计系统，包括色彩、字体、组件库、图标等设计规范和使用示例...",
    path: "/Users/zhangjun/Videos/设计系统演示.mkv",
    timeLabel: "创建于",
    date: "1 个月前",
    fullDate: "2023-12-15 09:00",
    tags: [
      { label: "设计系统", type: "custom", color: "blue" },
      { label: "规范", type: "ai" },
      { label: "视频", type: "system" },
    ],
  },
  {
    id: "16",
    type: "飞书文档",
    title: "产品需求评审会议纪要",
    preview: "记录了产品需求评审会议的讨论内容，包括新功能的优先级排序、技术可行性分析和开发排期安排...",
    path: "https://feishu.cn/docs/doccnXXXXXXXXXXXXXXXXXXXXXX",
    timeLabel: "最后编辑",
    date: "1 个月前",
    fullDate: "2023-12-10 10:00",
    tags: [
      { label: "会议纪要", type: "custom", color: "blue" },
      { label: "需求评审", type: "ai" },
      { label: "飞书", type: "system" },
    ],
  },
  {
    id: "17",
    type: "Google Docs",
    title: "市场调研报告 - 知识管理赛道分析",
    preview: "深入分析了知识管理工具市场的现状、竞争格局、用户需求和发展趋势，为产品战略提供参考...",
    path: "https://docs.google.com/document/d/1XXXXXXXXXXXXXXXXXXXXXXXX",
    timeLabel: "最后编辑",
    date: "1 个月前",
    fullDate: "2023-12-08 15:00",
    tags: [
      { label: "市场调研", type: "custom", color: "green" },
      { label: "报告", type: "ai" },
      { label: "Google Docs", type: "system" },
    ],
  },
  {
    id: "18",
    type: "Notion",
    title: "团队 Wiki - 开发规范",
    preview: "团队共享的开发规范文档，包括代码风格、Git 工作流、测试规范、文档规范等内容...",
    path: "https://notion.so/team-wiki-dev-standards-XXXXXXXX",
    timeLabel: "最后编辑",
    date: "1 个月前",
    fullDate: "2023-12-05 11:00",
    tags: [
      { label: "开发规范", type: "custom", color: "blue" },
      { label: "Wiki", type: "ai" },
      { label: "Notion", type: "system" },
    ],
  },
  {
    id: "19",
    type: "语雀文档",
    title: "产品设计规范 v3.0",
    preview: "详细定义了产品的设计规范，包括视觉风格、组件库、交互规范、动效规范等，确保产品体验一致性...",
    path: "https://yuque.com/team/design-system-v3",
    timeLabel: "最后编辑",
    date: "1 个月前",
    fullDate: "2023-12-03 14:00",
    tags: [
      { label: "设计规范", type: "custom", color: "purple" },
      { label: "v3.0", type: "ai" },
      { label: "语雀", type: "system" },
    ],
  },
  {
    id: "20",
    type: "网页",
    title: "用户研究报告 - 知识管理工具调研",
    preview: "通过用户访谈和问卷调查，我们发现用户最需要的是一个能够整合各类资料的中心，支持智能搜索和 AI 辅助...",
    path: "https://example.com/research/knowledge-management-tools",
    timeLabel: "发布于",
    date: "2 个月前",
    fullDate: "2023-11-15 10:00",
    tags: [
      { label: "用户研究", type: "custom", color: "green" },
      { label: "报告", type: "ai" },
      { label: "网页", type: "system" },
    ],
  },
  {
    id: "21",
    type: "网页",
    title: "AI 技术趋势报告 2024",
    preview: "分析了 2024 年 AI 技术的最新趋势，包括大语言模型、多模态 AI、AI Agent 等前沿技术的发展方向...",
    path: "https://techcrunch.com/ai-trends-2024",
    timeLabel: "保存于",
    date: "2 个月前",
    fullDate: "2023-11-10 16:00",
    tags: [
      { label: "AI", type: "custom", color: "purple" },
      { label: "技术趋势", type: "ai" },
      { label: "网页", type: "system" },
    ],
  },
  {
    id: "22",
    type: "网页",
    title: "Electron 最佳实践指南",
    preview: "总结了 Electron 开发的最佳实践，包括性能优化、安全性、打包发布等方面的经验和技巧...",
    path: "https://electronjs.org/docs/tutorial/best-practices",
    timeLabel: "保存于",
    date: "2 个月前",
    fullDate: "2023-11-05 09:00",
    tags: [
      { label: "Electron", type: "custom", color: "blue" },
      { label: "最佳实践", type: "ai" },
      { label: "技术文档", type: "ai" },
    ],
  },
];
