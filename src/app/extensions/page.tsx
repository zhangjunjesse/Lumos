"use client";

import { Suspense, useState } from "react";
import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { HugeiconsIcon } from "@hugeicons/react";
import { Loading } from "@hugeicons/core-free-icons";
import { SkillsManager } from "@/components/skills/SkillsManager";
import { McpManager } from "@/components/plugins/McpManager";
import { FeishuPanel } from "@/components/feishu/FeishuPanel";
import { ExtensionPackManager } from "@/components/extensions/ExtensionPackManager";
import { ExtensionBuilderPanel } from "@/components/extensions/ExtensionBuilderPanel";
import { DeepSearchPanel } from "@/components/deepsearch/DeepSearchPanel";
import { useTranslation } from "@/hooks/useTranslation";

type ExtTab = "skills" | "mcp" | "feishu" | "builder" | "deepsearch";

export default function ExtensionsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center">
          <HugeiconsIcon icon={Loading} className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <ExtensionsPageInner />
    </Suspense>
  );
}

function ExtensionsPageInner() {
  const searchParams = useSearchParams();
  const initialTab = (searchParams.get("tab") as ExtTab) || "skills";
  const [tab, setTab] = useState<ExtTab>(initialTab);
  const [refreshKey, setRefreshKey] = useState(0);
  const { t } = useTranslation();

  useEffect(() => {
    const handler = () => setRefreshKey((value) => value + 1);
    window.addEventListener('extensions-updated', handler);
    return () => window.removeEventListener('extensions-updated', handler);
  }, []);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-border/50 px-6 py-2">
        <Tabs value={tab} onValueChange={(v) => setTab(v as ExtTab)}>
          <TabsList>
            <TabsTrigger value="skills">{t('extensions.skills')}</TabsTrigger>
            <TabsTrigger value="mcp">{t('extensions.mcpServers')}</TabsTrigger>
            <TabsTrigger value="deepsearch">{t('extensions.deepsearch')}</TabsTrigger>
            <TabsTrigger value="builder">{t('extensions.builder')}</TabsTrigger>
            <TabsTrigger value="feishu">{t('extensions.feishu')}</TabsTrigger>
          </TabsList>
        </Tabs>
        <ExtensionPackManager onImported={() => setRefreshKey((value) => value + 1)} />
      </div>
      <div className="flex-1 overflow-hidden p-6 flex flex-col min-h-0">
        {tab === "skills" && <SkillsManager refreshKey={refreshKey} />}
        {tab === "mcp" && <McpManager refreshKey={refreshKey} />}
        {tab === "deepsearch" && <DeepSearchPanel />}
        {tab === "builder" && <ExtensionBuilderPanel />}
        {tab === "feishu" && <FeishuPanel />}
      </div>
    </div>
  );
}
