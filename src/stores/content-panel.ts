import create from 'zustand';
import { persist } from 'zustand/middleware';

export type TabType = 'file-tree' | 'feishu-doc' | 'settings' | 'knowledge' | 'plugins';

export interface Tab {
  id: string; // UUID
  type: TabType;
  title: string;
  icon?: string; // Hugeicons icon name
  closable: boolean; // 是否可关闭
  data?: unknown; // 标签特定数据（如文档 ID）
  order: number; // 排序
}

export interface TabState {
  tabs: Tab[];
  activeTabId: string | null;
}

interface ContentPanelStore extends TabState {
  // Actions
  addTab: (tab: Omit<Tab, 'id' | 'order'>) => void;
  removeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  updateTab: (tabId: string, updates: Partial<Tab>) => void;
  reorderTabs: (tabIds: string[]) => void;
  closeAllTabs: () => void;
  closeOtherTabs: (tabId: string) => void;
}

export const useContentPanelStore = create<ContentPanelStore>()(
  persist(
    (set, get) => ({
      tabs: [],
      activeTabId: null,

      addTab: (tab) => {
        const id = crypto.randomUUID();
        const order = get().tabs.length;
        const newTab: Tab = { ...tab, id, order };

        set((state) => ({
          tabs: [...state.tabs, newTab],
          activeTabId: id,
        }));
      },

      removeTab: (tabId) => {
        set((state) => {
          const index = state.tabs.findIndex((t) => t.id === tabId);
          if (index === -1) return state; // Tab not found, no change

          const tabs = state.tabs.filter((t) => t.id !== tabId);
          let activeTabId = state.activeTabId;

          // If closing the active tab, activate an adjacent tab
          if (activeTabId === tabId && tabs.length > 0) {
            activeTabId = tabs[Math.min(index, tabs.length - 1)].id;
          } else if (tabs.length === 0) {
            activeTabId = null;
          }

          return { tabs, activeTabId };
        });
      },

      setActiveTab: (tabId) => {
        set({ activeTabId: tabId });
      },

      updateTab: (tabId, updates) => {
        set((state) => ({
          tabs: state.tabs.map((t) => (t.id === tabId ? { ...t, ...updates } : t)),
        }));
      },

      reorderTabs: (tabIds) => {
        set((state) => {
          const tabMap = new Map(state.tabs.map((t) => [t.id, t]));
          const tabs = tabIds
            .map((id, index) => {
              const tab = tabMap.get(id);
              return tab ? { ...tab, order: index } : null;
            })
            .filter((t): t is Tab => t !== null);

          return { tabs };
        });
      },

      closeAllTabs: () => {
        set({ tabs: [], activeTabId: null });
      },

      closeOtherTabs: (tabId) => {
        set((state) => ({
          tabs: state.tabs.filter((t) => t.id === tabId),
          activeTabId: tabId,
        }));
      },
    }),
    {
      name: 'content-panel-storage',
      partialize: (state) => ({
        tabs: state.tabs,
        activeTabId: state.activeTabId,
      }),
    }
  )
);
