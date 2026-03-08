'use client';

import { useState } from 'react';

interface MemoryInfluence {
  text: string;
  memoryId: string;
  memoryContent: string;
}

interface MemoryHighlightProps {
  content: string;
  influences?: MemoryInfluence[];
}

export function MemoryHighlight({ content, influences }: MemoryHighlightProps) {
  const [hoveredMemory, setHoveredMemory] = useState<string | null>(null);

  if (!influences || influences.length === 0) {
    return <span>{content}</span>;
  }

  // 简化实现：直接显示内容，hover时显示记忆来源
  return (
    <span className="relative">
      {content}
      {influences.length > 0 && (
        <span
          className="ml-1 text-xs text-blue-500 cursor-help"
          onMouseEnter={() => setHoveredMemory(influences[0].memoryId)}
          onMouseLeave={() => setHoveredMemory(null)}
        >
          [记忆]
        </span>
      )}
      {hoveredMemory && (
        <div className="absolute z-10 mt-1 p-2 bg-white dark:bg-gray-800 border rounded shadow-lg text-xs max-w-xs">
          来源记忆：{influences[0].memoryContent}
        </div>
      )}
    </span>
  );
}
