'use client';

import * as React from 'react';
import { MessageCircleHeart } from 'lucide-react';

export function WeChatHero(): React.ReactElement {
  return (
    <header className="border-b">
      <div className="flex items-center gap-3 px-10 py-5">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500 text-white shadow-sm">
          <MessageCircleHeart className="size-5" strokeWidth={1.75} />
        </div>
        <h1 className="text-base font-semibold tracking-tight">微信助手</h1>
      </div>
    </header>
  );
}
