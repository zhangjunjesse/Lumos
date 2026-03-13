'use client';

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export interface URLSuggestion {
  value: string;
  label: string;
  meta?: string;
}

export interface URLAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  suggestions?: URLSuggestion[];
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  disabled?: boolean;
}

export function URLAutocomplete({
  value,
  onChange,
  onSubmit,
  suggestions = [],
  placeholder,
  className,
  inputClassName,
  disabled = false,
}: URLAutocompleteProps) {
  const [highlightedValue, setHighlightedValue] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const filteredSuggestions = useMemo(() => {
    const query = value.trim().toLowerCase();
    if (!query) {
      return suggestions.slice(0, 6);
    }

    return suggestions
      .filter((suggestion) => {
        const haystack = `${suggestion.label} ${suggestion.value} ${suggestion.meta || ''}`.toLowerCase();
        return haystack.includes(query);
      })
      .slice(0, 6);
  }, [suggestions, value]);
  const highlightedIndex = highlightedValue
    ? filteredSuggestions.findIndex((suggestion) => suggestion.value === highlightedValue)
    : -1;

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, []);

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!open || filteredSuggestions.length === 0) {
      if (event.key === 'Enter') {
        event.preventDefault();
        onSubmit(value);
      }
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      const nextIndex = highlightedIndex < 0 ? 0 : (highlightedIndex + 1) % filteredSuggestions.length;
      setHighlightedValue(filteredSuggestions[nextIndex]?.value ?? null);
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      const nextIndex = highlightedIndex <= 0 ? filteredSuggestions.length - 1 : highlightedIndex - 1;
      setHighlightedValue(filteredSuggestions[nextIndex]?.value ?? null);
      return;
    }

    if (event.key === 'Escape') {
      setOpen(false);
      setHighlightedValue(null);
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      const selectedSuggestion = highlightedIndex >= 0 ? filteredSuggestions[highlightedIndex] : null;
      onSubmit(selectedSuggestion?.value || value);
      setOpen(false);
    }
  };

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <Input
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        className={cn(
          'h-9 rounded-full border-border/60 bg-background/80 pl-4 pr-4 text-sm shadow-sm',
          inputClassName,
        )}
        onChange={(event) => {
          onChange(event.target.value);
          setHighlightedValue(null);
          setOpen(true);
        }}
        onFocus={() => {
          if (filteredSuggestions.length > 0) {
            setHighlightedValue(null);
            setOpen(true);
          }
        }}
        onKeyDown={handleKeyDown}
      />

      {open && filteredSuggestions.length > 0 && (
        <div className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-20 overflow-hidden rounded-2xl border border-border/70 bg-popover shadow-xl">
          <div className="border-b border-border/60 px-3 py-2 text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
            Suggestions
          </div>
          <div className="max-h-72 overflow-y-auto p-1.5">
            {filteredSuggestions.map((suggestion, index) => (
              <button
                key={`${suggestion.value}-${index}`}
                type="button"
                className={cn(
                  'flex w-full flex-col rounded-xl px-3 py-2 text-left transition-colors',
                  index === highlightedIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60',
                )}
                onMouseEnter={() => setHighlightedValue(suggestion.value)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onSubmit(suggestion.value);
                  setHighlightedValue(null);
                  setOpen(false);
                }}
              >
                <span className="truncate text-sm font-medium">{suggestion.label}</span>
                <span className="truncate text-xs text-muted-foreground">{suggestion.meta || suggestion.value}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
