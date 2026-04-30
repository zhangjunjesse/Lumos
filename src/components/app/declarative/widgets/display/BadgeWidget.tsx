'use client';

import * as React from 'react';

import { Badge } from '@/components/ui/badge';

import { useResolvedTemplate } from '../../binding-context';

export function BadgeWidget({
  widget,
}: {
  widget: { type: 'badge'; value: string };
}): React.ReactElement {
  const text = useResolvedTemplate(widget.value);
  return <Badge variant="secondary">{text}</Badge>;
}
