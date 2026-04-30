'use client';

import * as React from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';

import { useResolvedTemplate } from '../../binding-context';

export interface MarkdownWidgetProps {
  widget: { type: 'markdown'; content: string };
}

export function MarkdownWidget({ widget }: MarkdownWidgetProps): React.ReactElement {
  const rendered = useResolvedTemplate(widget.content);
  return (
    <div className="prose prose-sm max-w-none dark:prose-invert">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
        {rendered}
      </ReactMarkdown>
    </div>
  );
}
