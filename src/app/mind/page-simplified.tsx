'use client';

import { useState, useEffect } from 'react';
import { MemoryStats } from '@/components/mind/memory-stats';
import { MemoryToolbar } from '@/components/mind/memory-toolbar';
import { MemoryGrid } from '@/components/mind/memory-grid';
import { MemoryEmptyState } from '@/components/mind/memory-empty-state';

interface Memory {
  id: string;
  content: string;
  category: string;
  scope: string;
  hitCount: number;
  isPinned?: boolean;
  lastUsedAt: string | null;
  updatedAt: string;
}

export default function MindPage() {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [selectedScope, setSelectedScope] = useState('');

  useEffect(() => {
    fetchMemories();
  }, []);

  async function fetchMemories() {
    try {
      const res = await fetch('/api/mind?limit=100');
      const data = await res.json();
      setMemories(data.memories || []);
    } catch (error) {
      console.error('Failed to fetch memories:', error);
    } finally {
      setLoading(false);
    }
  }

  const filteredMemories = memories.filter(m => {
    if (searchQuery && !m.content.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    if (selectedCategory && m.category !== selectedCategory) return false;
    if (selectedScope && m.scope !== selectedScope) return false;
    return true;
  });

  const stats = {
    total: memories.length,
    byCategory: memories.reduce((acc, m) => {
      acc[m.category] = (acc[m.category] || 0) + 1;
      return acc;
    }, {} as Record<string, number>),
    byScope: memories.reduce((acc, m) => {
      acc[m.scope] = (acc[m.scope] || 0) + 1;
      return acc;
    }, {} as Record<string, number>),
    totalUsage: memories.reduce((sum, m) => sum + m.hitCount, 0),
  };

  async function handlePin(id: string) {
    // TODO: 实现置顶功能
    console.log('Pin:', id);
  }

  async function handleArchive(id: string) {
    // TODO: 实现归档功能
    console.log('Archive:', id);
  }

  async function handleDelete(id: string) {
    if (!confirm('确认删除这条记忆？')) return;
    try {
      await fetch(`/api/mind/memories/${id}`, { method: 'DELETE' });
      await fetchMemories();
    } catch (error) {
      console.error('Failed to delete memory:', error);
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center h-full">加载中...</div>;
  }

  return (
    <div className="container mx-auto p-6 max-w-7xl">
      <h1 className="text-3xl font-bold mb-2">AI 记忆</h1>
      <p className="text-gray-600 dark:text-gray-400 mb-6">Lumos 对你的了解</p>

      {memories.length > 0 ? (
        <>
          <MemoryStats {...stats} />
          <MemoryToolbar
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            selectedCategory={selectedCategory}
            onCategoryChange={setSelectedCategory}
            selectedScope={selectedScope}
            onScopeChange={setSelectedScope}
          />
          <MemoryGrid
            memories={filteredMemories}
            onPin={handlePin}
            onArchive={handleArchive}
            onDelete={handleDelete}
          />
        </>
      ) : (
        <MemoryEmptyState />
      )}
    </div>
  );
}
