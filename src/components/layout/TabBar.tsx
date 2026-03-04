"use client";

import { useContentPanelStore, type Tab, type TabType } from '@/stores/content-panel';
import { usePanel } from '@/hooks/usePanel';
import { useTranslation } from '@/hooks/useTranslation';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  Cancel01Icon,
  Add01Icon,
  FolderOpenIcon,
  File02Icon,
  Settings02Icon,
  BookOpen01Icon,
  PuzzleIcon,
  PinIcon,
  PanelRightCloseIcon,
} from '@hugeicons/core-free-icons';
import { cn } from '@/lib/utils';
import type { TranslationKey } from '@/i18n';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  horizontalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

// Tab type configuration (icons and closable state)
const TAB_TYPE_CONFIG: Record<
  TabType,
  { i18nKey: TranslationKey; icon: typeof FolderOpenIcon; closable: boolean }
> = {
  'file-tree': { i18nKey: 'tab.fileTree', icon: FolderOpenIcon, closable: false },
  'file-preview': { i18nKey: 'tab.filePreview', icon: File02Icon, closable: true },
  'feishu-doc': { i18nKey: 'tab.feishuDoc', icon: File02Icon, closable: true },
  settings: { i18nKey: 'tab.settings', icon: Settings02Icon, closable: true },
  knowledge: { i18nKey: 'tab.knowledge', icon: BookOpen01Icon, closable: true },
  plugins: { i18nKey: 'tab.plugins', icon: PuzzleIcon, closable: true },
};

// Pixels to move before drag starts (prevents accidental drags)
const DRAG_ACTIVATION_DISTANCE = 8;

export function TabBar() {
  const { tabs, activeTabId, setActiveTab, removeTab, addTab, reorderTabs, pinTab } = useContentPanelStore();
  const { setContentPanelOpen } = usePanel();
  const { t } = useTranslation();

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: DRAG_ACTIVATION_DISTANCE,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = tabs.findIndex((tab) => tab.id === active.id);
      const newIndex = tabs.findIndex((tab) => tab.id === over.id);

      // Validate indices before reordering
      if (oldIndex === -1 || newIndex === -1) {
        console.error('Invalid drag indices', { oldIndex, newIndex, activeId: active.id, overId: over.id });
        return;
      }

      const newTabs = arrayMove(tabs, oldIndex, newIndex);
      reorderTabs(newTabs.map((tab) => tab.id));
    }
  };

  const handleAddTab = (type: TabType) => {
    const config = TAB_TYPE_CONFIG[type];
    addTab({
      type,
      title: t(config.i18nKey),
      closable: config.closable,
    });
  };

  return (
    <div className="flex h-10 shrink-0 items-center gap-1 border-b px-2">
      {/* Tab list */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={tabs.map((tab) => tab.id)}
          strategy={horizontalListSortingStrategy}
        >
          <div className="flex flex-1 items-center gap-1 overflow-x-auto">
            {tabs.map((tab) => (
              <SortableTabItem
                key={tab.id}
                tab={tab}
                active={tab.id === activeTabId}
                onSelect={() => setActiveTab(tab.id)}
                onClose={() => removeTab(tab.id)}
                onPin={() => pinTab(tab.id)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {/* Add button */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" className="shrink-0">
            <HugeiconsIcon icon={Add01Icon} className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {Object.entries(TAB_TYPE_CONFIG).map(([type, config]) => (
            <DropdownMenuItem
              key={type}
              onClick={() => handleAddTab(type as TabType)}
              className="flex items-center gap-2"
            >
              <HugeiconsIcon icon={config.icon} className="h-4 w-4" />
              <span>{t(config.i18nKey)}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Collapse button */}
      <Button
        variant="ghost"
        size="icon-sm"
        className="shrink-0"
        onClick={() => setContentPanelOpen(false)}
        title={t('contentPanel.closePanel')}
      >
        <HugeiconsIcon icon={PanelRightCloseIcon} className="h-4 w-4" />
      </Button>
    </div>
  );
}

interface TabItemProps {
  tab: Tab;
  active: boolean;
  onSelect: () => void;
  onClose: () => void;
  onPin: () => void;
}

function SortableTabItem({ tab, active, onSelect, onClose, onPin }: TabItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: tab.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      role="tab"
      aria-selected={active}
      aria-label={`${tab.title} tab${tab.closable ? ', closable' : ''}`}
      className={cn(
        'flex items-center gap-1 rounded px-2 py-1 text-xs cursor-grab active:cursor-grabbing transition-colors',
        active ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50',
        isDragging && 'z-50',
        tab.isTemporary && 'italic' // 临时标签用斜体显示
      )}
      onClick={onSelect}
    >
      {tab.icon && <span className="text-sm">{tab.icon}</span>}
      <span className="truncate max-w-[100px]">{tab.title}</span>
      {tab.isTemporary ? (
        // 临时标签显示固定按钮
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={(e) => {
            e.stopPropagation();
            onPin();
          }}
          className="ml-1 h-4 w-4 p-0"
          title="Pin tab"
        >
          <HugeiconsIcon icon={PinIcon} className="h-3 w-3" />
        </Button>
      ) : tab.closable ? (
        // 持久标签显示关闭按钮
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="ml-1 h-4 w-4 p-0"
        >
          <HugeiconsIcon icon={Cancel01Icon} className="h-3 w-3" />
        </Button>
      ) : null}
    </div>
  );
}
