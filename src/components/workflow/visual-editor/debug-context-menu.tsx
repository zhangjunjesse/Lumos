'use client';

import { useEffect, useRef } from 'react';
import type { DebugStepCacheMeta } from '@/lib/workflow/debug-types';

export interface DebugMenuTarget {
  stepId: string;
  stepType: string;
  inContainer: boolean;
  x: number;
  y: number;
}

interface Props {
  target: DebugMenuTarget;
  meta?: DebugStepCacheMeta;
  running: boolean;
  onRunTo: (stepId: string) => void;
  onRerunOnly: (stepId: string) => void;
  onContinueFrom: (stepId: string) => void;
  onViewOutput: (stepId: string) => void;
  onDeleteCache: (stepId: string, cascade: boolean) => void;
  onClose: () => void;
}

interface MenuItem {
  label: string;
  disabled?: boolean;
  danger?: boolean;
  divider?: boolean;
  onClick?: () => void;
}

function buildItems(p: Props): MenuItem[] {
  const { target, meta, running, onRunTo, onRerunOnly, onContinueFrom, onViewOutput, onDeleteCache, onClose } = p;
  const { stepId, inContainer } = target;
  const has = !!meta;
  const fresh = has && !meta.stale;
  const disabledReason = inContainer ? '容器子节点不支持单独调试' : running ? '当前有节点在跑' : '';
  const block = !!disabledReason;

  const tail = (fn: () => void) => () => { fn(); onClose(); };

  return [
    {
      label: '运行到此处',
      disabled: block,
      onClick: tail(() => onRunTo(stepId)),
    },
    {
      label: '重跑此节点',
      disabled: block,
      onClick: tail(() => onRerunOnly(stepId)),
    },
    {
      label: '从此处继续',
      disabled: block || !fresh,
      onClick: tail(() => onContinueFrom(stepId)),
    },
    { label: '', divider: true },
    {
      label: '查看缓存输出',
      disabled: !has,
      onClick: tail(() => onViewOutput(stepId)),
    },
    {
      label: '清除此节点缓存',
      disabled: !has,
      onClick: tail(() => onDeleteCache(stepId, false)),
      danger: true,
    },
    {
      label: '清除此节点及下游',
      disabled: !has,
      onClick: tail(() => onDeleteCache(stepId, true)),
      danger: true,
    },
  ];
}

export function DebugContextMenu(props: Props) {
  const { target, onClose } = props;
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('mousedown', onDocClick);
    window.addEventListener('keydown', onEsc);
    return () => {
      window.removeEventListener('mousedown', onDocClick);
      window.removeEventListener('keydown', onEsc);
    };
  }, [onClose]);

  const items = buildItems(props);

  return (
    <div
      ref={ref}
      className="fixed z-50 min-w-[180px] rounded-md border border-border/70 bg-popover shadow-lg py-1 text-[11px]"
      style={{ left: target.x, top: target.y }}
      onContextMenu={e => e.preventDefault()}
    >
      {items.map((it, i) => {
        if (it.divider) return <div key={i} className="h-px bg-border/50 my-1" />;
        return (
          <button
            key={i}
            type="button"
            disabled={it.disabled}
            onClick={it.onClick}
            className={[
              'w-full text-left px-2.5 py-1 flex items-center transition-colors',
              it.disabled ? 'text-muted-foreground/50 cursor-not-allowed' : 'hover:bg-accent',
              it.danger && !it.disabled ? 'text-red-600 dark:text-red-400 hover:bg-red-500/10' : '',
            ].join(' ')}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}
