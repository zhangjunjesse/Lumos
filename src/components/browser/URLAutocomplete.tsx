/**
 * URL Autocomplete Component
 * 地址栏自动补全
 */

'use client';

import React, { useState, useEffect, useRef } from 'react';

export interface AutocompleteItem {
  url: string;
  title: string;
  type: 'history' | 'bookmark' | 'suggestion';
}

export interface URLAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  onSelect: (url: string) => void;
  placeholder?: string;
  className?: string;
}

export function URLAutocomplete({
  value,
  onChange,
  onSelect,
  placeholder,
  className,
}: URLAutocompleteProps) {
  const [suggestions, setSuggestions] = useState<AutocompleteItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  // 获取建议
  useEffect(() => {
    if (!value || value.length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    // TODO: 从历史记录和书签中获取建议
    // 这里先用模拟数据
    const mockSuggestions: AutocompleteItem[] = [
      { url: 'https://google.com', title: 'Google', type: 'history' },
      { url: 'https://github.com', title: 'GitHub', type: 'bookmark' },
    ].filter(item =>
      item.url.toLowerCase().includes(value.toLowerCase()) ||
      item.title.toLowerCase().includes(value.toLowerCase())
    );

    setSuggestions(mockSuggestions);
    setShowSuggestions(mockSuggestions.length > 0);
    setSelectedIndex(-1);
  }, [value]);

  // 键盘导航
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showSuggestions || suggestions.length === 0) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex(prev =>
          prev < suggestions.length - 1 ? prev + 1 : prev
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(prev => (prev > 0 ? prev - 1 : -1));
        break;
      case 'Enter':
        e.preventDefault();
        if (selectedIndex >= 0) {
          onSelect(suggestions[selectedIndex].url);
          setShowSuggestions(false);
        }
        break;
      case 'Escape':
        setShowSuggestions(false);
        break;
    }
  };

  // 点击建议项
  const handleSelectSuggestion = (item: AutocompleteItem) => {
    onSelect(item.url);
    setShowSuggestions(false);
  };

  // 点击外部关闭建议
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        suggestionsRef.current &&
        !suggestionsRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setShowSuggestions(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative flex-1">
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
        placeholder={placeholder || 'Enter URL or search...'}
        className={className || 'w-full px-4 py-2 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500'}
      />

      {showSuggestions && suggestions.length > 0 && (
        <div
          ref={suggestionsRef}
          className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-64 overflow-y-auto z-50"
        >
          {suggestions.map((item, index) => (
            <div
              key={`${item.url}-${index}`}
              onClick={() => handleSelectSuggestion(item)}
              className={`
                px-4 py-2 cursor-pointer hover:bg-gray-100
                ${index === selectedIndex ? 'bg-blue-50' : ''}
              `}
            >
              <div className="flex items-center gap-2">
                <div className="flex-shrink-0 w-4 h-4">
                  {item.type === 'history' && (
                    <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  )}
                  {item.type === 'bookmark' && (
                    <svg className="w-4 h-4 text-yellow-500" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                    </svg>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{item.title}</div>
                  <div className="text-sm text-gray-500 truncate">{item.url}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
