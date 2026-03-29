import create from 'zustand';
import { persist } from 'zustand/middleware';

export type TabType =
  | 'file-tree'
  | 'browser'
  | 'favorites'
  | 'feishu-doc'
  | 'feishu-doc-preview'
  | 'settings'
  | 'knowledge'
  | 'plugins'
  | 'file-preview'
  | 'task-activity';

export interface Tab {
  id: string; // UUID
  type: TabType;
  title: string;
  icon?: string; // Hugeicons icon name
  closable: boolean; // 是否可关闭
  data?: unknown; // 标签特定数据（如文档 ID）
  order: number; // 排序
  isTemporary?: boolean; // 是否为临时标签（不持久化）
  filePath?: string; // 文件路径（用于 file-preview 类型）
}

export interface TabState {
  tabs: Tab[];
  activeTabId: string | null;
}

interface ContentPanelStore extends TabState {
  // Actions
  addTab: (tab: Omit<Tab, 'order'> | Omit<Tab, 'id' | 'order'>) => void;
  removeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  updateTab: (tabId: string, updates: Partial<Tab>) => void;
  reorderTabs: (tabIds: string[]) => void;
  closeAllTabs: () => void;
  closeOtherTabs: (tabId: string) => void;
  pinTab: (tabId: string) => void; // 将临时标签固定为持久标签
}

export const useContentPanelStore = create<ContentPanelStore>(
  persist(
    (set, get) => ({
      tabs: [],
      activeTabId: null,

      addTab: (tab: Omit<Tab, 'order'> | Omit<Tab, 'id' | 'order'>) => {
        try {
          // 如果传入了 id，使用传入的 id；否则生成新的 id
          const id = ('id' in tab && tab.id) ? tab.id : crypto.randomUUID();

          // 检查是否已存在相同 id 的标签
          const existingTab = get().tabs.find(t => t.id === id);
          if (existingTab) {
            set({ activeTabId: id });
            return;
          }

          const order = get().tabs.length;
          const newTab: Tab = { ...tab, id, order } as Tab;

          set((state) => {
            let tabs = state.tabs;

            // 如果添加临时标签，移除现有的临时标签
            if (newTab.isTemporary) {
              tabs = tabs.filter(t => !t.isTemporary);
            }

            return {
              tabs: [...tabs, newTab],
              activeTabId: id,
            };
          });
        } catch (error) {
          console.error('[content-panel] Error in addTab:', error);
        }
      },

      removeTab: (tabId: string) => {
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

      setActiveTab: (tabId: string) => {
        set({ activeTabId: tabId });
      },

      updateTab: (tabId: string, updates: Partial<Tab>) => {
        set((state) => ({
          tabs: state.tabs.map((t) => (t.id === tabId ? { ...t, ...updates } : t)),
        }));
      },

      reorderTabs: (tabIds: string[]) => {
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

      closeOtherTabs: (tabId: string) => {
        set((state) => ({
          tabs: state.tabs.filter((t) => t.id === tabId),
          activeTabId: tabId,
        }));
      },

      pinTab: (tabId: string) => {
        set((state) => ({
          tabs: state.tabs.map((t) =>
            t.id === tabId ? { ...t, isTemporary: false } : t
          ),
        }));
      },
    }),
    {
      name: 'content-panel-storage',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Zustand persist typing conflicts with Tab.data unknown.
      partialize: (state: any) => ({
        tabs: state.tabs.filter((t: Tab) => !t.isTemporary), // 排除临时标签
        activeTabId: state.activeTabId,
      }),
    }
  )
);
