import { redirect } from "next/navigation";

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

export default function RootPage() {
  redirect("/main-agent");
}
