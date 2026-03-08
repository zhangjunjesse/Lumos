'use client';

import { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

type IconVariant = 'user-profile' | 'ai-persona' | 'rules';

interface SectionIconProps {
  icon: LucideIcon;
  variant: IconVariant;
  size?: number;
  className?: string;
}

export function SectionIcon({ icon: Icon, variant, size = 32, className }: SectionIconProps) {
  const colorClass = {
    'user-profile': 'text-[var(--user-profile-text)]',
    'ai-persona': 'text-[var(--ai-persona-text)]',
    rules: 'text-[var(--rules-text)]',
  }[variant];

  return (
    <Icon
      size={size}
      className={cn(colorClass, 'relative z-10', className)}
      strokeWidth={2.5}
    />
  );
}
