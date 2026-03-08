'use client';

import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, Filter } from 'lucide-react';
import { categoryLabels, scopeLabels } from '@/lib/memory-labels';

interface MemoryToolbarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  selectedCategory: string;
  onCategoryChange: (category: string) => void;
  selectedScope: string;
  onScopeChange: (scope: string) => void;
}

export function MemoryToolbar({
  searchQuery,
  onSearchChange,
  selectedCategory,
  onCategoryChange,
  selectedScope,
  onScopeChange,
}: MemoryToolbarProps) {
  return (
    <div className="flex gap-3 mb-4">
      <div className="flex-1 relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <Input
          placeholder="搜索记忆内容..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="pl-10"
        />
      </div>
      <select
        value={selectedCategory}
        onChange={(e) => onCategoryChange(e.target.value)}
        className="px-3 py-2 border rounded-md"
      >
        <option value="">所有类别</option>
        <option value="preference">{categoryLabels.preference}</option>
        <option value="constraint">{categoryLabels.constraint}</option>
        <option value="fact">{categoryLabels.fact}</option>
        <option value="workflow">{categoryLabels.workflow}</option>
        <option value="other">{categoryLabels.other}</option>
      </select>
      <select
        value={selectedScope}
        onChange={(e) => onScopeChange(e.target.value)}
        className="px-3 py-2 border rounded-md"
      >
        <option value="">所有范围</option>
        <option value="global">{scopeLabels.global}</option>
        <option value="project">{scopeLabels.project}</option>
        <option value="session">{scopeLabels.session}</option>
      </select>
    </div>
  );
}
