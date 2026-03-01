"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/hooks/useTranslation";

interface EmptyStateProps {
  onRefresh: () => void;
}

export function EmptyState({ onRefresh }: EmptyStateProps) {
  const router = useRouter();
  const { t } = useTranslation();

  const createDoc = async () => {
    const res = await fetch("/api/documents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Untitled" }),
    });
    if (res.ok) {
      const doc = await res.json();
      router.push(`/documents/${doc.id}`);
    }
  };

  return (
    <div className="flex flex-col items-center py-16 text-center">
      <h2 className="mb-2 text-xl font-semibold">
        {t('workspace.welcomeToLumos')}
      </h2>
      <p className="mb-8 text-sm text-muted-foreground">
        {t('workspace.subtitle')}
      </p>

      <div className="flex gap-4">
        <EntryCard
          icon="✨"
          title={t('workspace.aiWriting')}
          desc={t('workspace.describeIdea')}
          onClick={createDoc}
        />
        <EntryCard
          icon="📥"
          title={t('workspace.import')}
          desc={t('workspace.existingDocuments')}
          onClick={() => {}}
        />
        <EntryCard
          icon="📝"
          title={t('workspace.blank')}
          desc={t('workspace.startFromScratch')}
          onClick={createDoc}
        />
      </div>
    </div>
  );
}

function EntryCard({
  icon,
  title,
  desc,
  onClick,
}: {
  icon: string;
  title: string;
  desc: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="flex w-36 flex-col items-center gap-2 rounded-xl border p-5 transition-colors hover:bg-accent"
      onClick={onClick}
    >
      <span className="text-2xl">{icon}</span>
      <span className="text-sm font-medium">{title}</span>
      <span className="text-xs text-muted-foreground">{desc}</span>
    </button>
  );
}
