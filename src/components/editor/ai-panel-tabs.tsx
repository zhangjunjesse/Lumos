"use client";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useTranslation } from "@/hooks/useTranslation";

interface Props {
  activeTab: string;
  onTabChange: (tab: string) => void;
  children: React.ReactNode;
  outlineContent?: React.ReactNode;
  referencesContent?: React.ReactNode;
}

export function AiPanelTabs({
  activeTab,
  onTabChange,
  children,
  outlineContent,
  referencesContent,
}: Props) {
  const { t } = useTranslation();
  return (
    <Tabs value={activeTab} onValueChange={onTabChange} className="flex h-full flex-col">
      <TabsList className="mx-3 mt-1 shrink-0">
        <TabsTrigger value="chat">{t('editor.tabChat')}</TabsTrigger>
        <TabsTrigger value="outline">{t('editor.tabOutline')}</TabsTrigger>
        <TabsTrigger value="references">{t('editor.tabReferences')}</TabsTrigger>
      </TabsList>

      <TabsContent value="chat" className="flex-1 overflow-hidden">
        {children}
      </TabsContent>

      <TabsContent value="outline" className="flex-1 overflow-auto p-3">
        {outlineContent ?? (
          <p className="text-sm text-muted-foreground">
            {t('editor.outlinePlaceholder')}
          </p>
        )}
      </TabsContent>

      <TabsContent value="references" className="flex-1 overflow-auto p-3">
        {referencesContent ?? (
          <p className="text-sm text-muted-foreground">
            {t('editor.referencesPlaceholder')}
          </p>
        )}
      </TabsContent>
    </Tabs>
  );
}
