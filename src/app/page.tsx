"use client";

export interface ContentItem {
  id: string;
  type: "document" | "conversation";
  title: string;
  preview: string;
  updated_at: string;
  source_type?: string;
  kb_status?: string;
  message_count?: number;
  tags?: string;
  is_starred?: number;
}

export default function WorkspacePage() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="text-center space-y-4">
        <div className="text-6xl">🚀</div>
        <h1 className="text-2xl font-semibold">功能即将上线</h1>
        <p className="text-muted-foreground">敬请期待</p>
      </div>
    </div>
  );
}
