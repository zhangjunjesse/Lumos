'use client';

import { ReactNode } from 'react';
import { cn } from '@/lib/utils';

type CardVariant = 'default' | 'user-profile' | 'ai-persona' | 'rules';
type CardState = 'normal' | 'editing' | 'success' | 'error';

interface MindCardProps {
  variant?: CardVariant;
  state?: CardState;
  icon?: ReactNode;
  title: string;
  description?: string;
  badge?: ReactNode;
  children?: ReactNode;
  onClick?: () => void;
  className?: string;
}

export function MindCard({
  variant = 'default',
  state = 'normal',
  icon,
  title,
  description,
  badge,
  children,
  onClick,
  className,
}: MindCardProps) {
  const variantClass = {
    default: '',
    'user-profile': 'mind-card-user-profile',
    'ai-persona': 'mind-card-ai-persona',
    rules: 'mind-card-rules',
  }[variant];

  const stateClass = {
    normal: '',
    editing: 'mind-card-editing',
    success: 'mind-save-success',
    error: 'mind-error-shake',
  }[state];

  return (
    <div
      className={cn('mind-card', variantClass, stateClass, className)}
      onClick={onClick}
    >
      {icon && (
        <div className="mind-icon-wrapper">
          <div className="mind-icon-pulse" />
          {icon}
        </div>
      )}

      <div className="flex items-start justify-between mb-2">
        <h3 className="text-lg font-semibold">{title}</h3>
        {badge}
      </div>

      {description && (
        <p className="text-sm text-muted-foreground mb-4">{description}</p>
      )}

      {children}
    </div>
  );
}
