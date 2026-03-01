"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/hooks/useTranslation";
import { CollectionList } from "@/components/knowledge/collection-list";
import { ItemList } from "@/components/knowledge/item-list";
import { SearchPanel } from "@/components/knowledge/search-panel";
import { ImportDialog } from "@/components/knowledge/import-dialog";

interface Collection {
  id: string;
  name: string;
  description: string;
  created_at: string;
}

interface KbItem {
  id: string;
  title: string;
  source_type: string;
  source_path: string;
  tags: string;
  updated_at: string;
}

export default function KnowledgePage() {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [items, setItems] = useState<KbItem[]>([]);
  const [name, setName] = useState("");
  const [showImport, setShowImport] = useState(false);
  const { t } = useTranslation();

  const fetchCollections = useCallback(async () => {
    const res = await fetch("/api/knowledge/collections");
    if (res.ok) setCollections(await res.json());
  }, []);

  const fetchItems = useCallback(async (cid: string) => {
    const res = await fetch(`/api/knowledge/items?collection_id=${cid}`);
    if (res.ok) setItems(await res.json());
  }, []);

  useEffect(() => { fetchCollections(); }, [fetchCollections]);
  useEffect(() => { if (selected) fetchItems(selected); }, [selected, fetchItems]);

  const createCollection = async () => {
    if (!name.trim()) return;
    await fetch("/api/knowledge/collections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    setName("");
    fetchCollections();
  };

  const deleteCollection = async (id: string) => {
    await fetch("/api/knowledge/collections", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (selected === id) { setSelected(null); setItems([]); }
    fetchCollections();
  };

  const deleteItem = async (id: string) => {
    await fetch("/api/knowledge/items", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (selected) fetchItems(selected);
  };

  return (
    <div className="flex h-full flex-col p-6">
      <h1 className="mb-4 text-2xl font-semibold">{t('knowledge.title')}</h1>

      <SearchPanel />

      <div className="mt-6 flex flex-1 gap-6 overflow-hidden">
        {/* Left: Collections */}
        <div className="w-64 shrink-0 space-y-3 overflow-auto">
          <div className="flex gap-2">
            <input
              className="flex-1 rounded-md border bg-background px-2 py-1.5 text-sm"
              placeholder={t('knowledge.newCollectionPlaceholder')}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && createCollection()}
            />
            <Button size="sm" onClick={createCollection}>+</Button>
          </div>
          <CollectionList
            collections={collections}
            selected={selected}
            onSelect={setSelected}
            onDelete={deleteCollection}
          />
        </div>

        {/* Right: Items */}
        <div className="min-w-0 flex-1 space-y-3 overflow-auto">
          {selected ? (
            <>
              <div className="flex items-center justify-between">
                <h2 className="font-medium">{t('knowledge.items')}</h2>
                <Button size="sm" variant="outline" onClick={() => setShowImport(!showImport)}>
                  {showImport ? t('common.cancel') : t('knowledge.import')}
                </Button>
              </div>
              {showImport && (
                <ImportDialog
                  collectionId={selected}
                  onImported={() => { setShowImport(false); fetchItems(selected); }}
                />
              )}
              <ItemList items={items} onDelete={deleteItem} />
            </>
          ) : (
            <p className="py-12 text-center text-muted-foreground">
              {t('knowledge.selectCollectionHint')}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
