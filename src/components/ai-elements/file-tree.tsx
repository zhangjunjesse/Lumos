"use client";

import type { HTMLAttributes, ReactNode } from "react";
import { useTranslation } from "@/hooks/useTranslation";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Folder,
  FolderOpen,
  File,
  ArrowRight,
  Add,
  BookOpen,
  Favorite,
} from "@hugeicons/core-free-icons";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

interface FileTreeContextType {
  expandedPaths: Set<string>;
  togglePath: (path: string) => void;
  selectedPath?: string;
  onSelect?: (path: string) => void;
  onAdd?: (path: string) => void;
  onAddToLibrary?: (path: string) => void;
  onFavorite?: (path: string) => void;
  isFavorited?: (path: string) => boolean;
}

// Default noop for context default value
// oxlint-disable-next-line eslint(no-empty-function)
const noop = () => {};

const FileTreeContext = createContext<FileTreeContextType>({
  // oxlint-disable-next-line eslint-plugin-unicorn(no-new-builtin)
  expandedPaths: new Set(),
  togglePath: noop,
});

export type FileTreeProps = HTMLAttributes<HTMLDivElement> & {
  expanded?: Set<string>;
  defaultExpanded?: Set<string>;
  selectedPath?: string;
  onSelect?: (path: string) => void;
  onAdd?: (path: string) => void;
  onAddToLibrary?: (path: string) => void;
  onFavorite?: (path: string) => void;
  isFavorited?: (path: string) => boolean;
  onExpandedChange?: (expanded: Set<string>) => void;
};

export const FileTree = ({
  expanded: controlledExpanded,
  defaultExpanded = new Set(),
  selectedPath,
  onSelect,
  onAdd,
  onAddToLibrary,
  onFavorite,
  isFavorited,
  onExpandedChange,
  className,
  children,
  ...props
}: FileTreeProps) => {
  const [internalExpanded, setInternalExpanded] = useState(defaultExpanded);
  const expandedPaths = controlledExpanded ?? internalExpanded;

  const togglePath = useCallback(
    (path: string) => {
      const newExpanded = new Set(expandedPaths);
      if (newExpanded.has(path)) {
        newExpanded.delete(path);
      } else {
        newExpanded.add(path);
      }
      setInternalExpanded(newExpanded);
      onExpandedChange?.(newExpanded);
    },
    [expandedPaths, onExpandedChange]
  );

  const contextValue = useMemo(
    () => ({ expandedPaths, onAdd, onAddToLibrary, onFavorite, onSelect, isFavorited, selectedPath, togglePath }),
    [expandedPaths, onAdd, onAddToLibrary, onFavorite, onSelect, isFavorited, selectedPath, togglePath]
  );

  return (
    <FileTreeContext.Provider value={contextValue}>
      <div
        className={cn(
          "rounded-lg border bg-background font-mono text-sm",
          className
        )}
        role="tree"
        {...props}
      >
        <div className="p-2">{children}</div>
      </div>
    </FileTreeContext.Provider>
  );
};

interface FileTreeFolderContextType {
  path: string;
  name: string;
  isExpanded: boolean;
}

const FileTreeFolderContext = createContext<FileTreeFolderContextType>({
  isExpanded: false,
  name: "",
  path: "",
});

export type FileTreeFolderProps = HTMLAttributes<HTMLDivElement> & {
  path: string;
  name: string;
};

export const FileTreeFolder = ({
  path,
  name,
  className,
  children,
  ...props
}: FileTreeFolderProps) => {
  const { expandedPaths, togglePath } =
    useContext(FileTreeContext);
  const isExpanded = expandedPaths.has(path);

  const handleToggle = useCallback(() => {
    togglePath(path);
  }, [togglePath, path]);

  const folderContextValue = useMemo(
    () => ({ isExpanded, name, path }),
    [isExpanded, name, path]
  );

  return (
    <FileTreeFolderContext.Provider value={folderContextValue}>
      <Collapsible onOpenChange={handleToggle} open={isExpanded}>
        <div
          className={cn("", className)}
          role="treeitem"
          aria-selected={false}
          tabIndex={0}
          {...props}
        >
          <div
            className="flex w-full items-center gap-1 rounded px-2 py-1 text-left transition-colors hover:bg-muted/50"
          >
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="shrink-0 rounded p-0.5 hover:bg-muted"
                onClick={(e) => e.stopPropagation()}
              >
                <HugeiconsIcon
                  icon={ArrowRight}
                  className={cn(
                    "size-4 text-muted-foreground transition-transform",
                    isExpanded && "rotate-90"
                  )}
                />
              </button>
            </CollapsibleTrigger>
            <FileTreeIcon>
              {isExpanded ? (
                <HugeiconsIcon icon={FolderOpen} className="size-4 text-muted-foreground" />
              ) : (
                <HugeiconsIcon icon={Folder} className="size-4 text-muted-foreground" />
              )}
            </FileTreeIcon>
            <FileTreeName>{name}</FileTreeName>
          </div>
          <CollapsibleContent>
            <div className="ml-4 border-l pl-2">{children}</div>
          </CollapsibleContent>
        </div>
      </Collapsible>
    </FileTreeFolderContext.Provider>
  );
};

interface FileTreeFileContextType {
  path: string;
  name: string;
}

const FileTreeFileContext = createContext<FileTreeFileContextType>({
  name: "",
  path: "",
});

export type FileTreeFileProps = HTMLAttributes<HTMLDivElement> & {
  path: string;
  name: string;
  icon?: ReactNode;
};

export const FileTreeFile = ({
  path,
  name,
  icon,
  className,
  children,
  ...props
}: FileTreeFileProps) => {
  const { t } = useTranslation();
  const { selectedPath, onSelect, onAdd, onAddToLibrary, onFavorite, isFavorited } = useContext(FileTreeContext);
  const isSelected = selectedPath === path;
  const favorited = isFavorited?.(path) ?? false;

  const handleClick = useCallback(() => {
    onSelect?.(path);
  }, [onSelect, path]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        onSelect?.(path);
      }
    },
    [onSelect, path]
  );

  const handleAdd = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onAdd?.(path);
    },
    [onAdd, path]
  );

  const handleAddToLibrary = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onAddToLibrary?.(path);
    },
    [onAddToLibrary, path]
  );

  const handleFavorite = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onFavorite?.(path);
    },
    [onFavorite, path]
  );

  const fileContextValue = useMemo(() => ({ name, path }), [name, path]);

  return (
    <FileTreeFileContext.Provider value={fileContextValue}>
      <div
        {...props}
        className={cn(
          "group/file flex cursor-pointer items-center gap-1 rounded px-2 py-1 transition-colors hover:bg-muted/50",
          isSelected && "bg-muted",
          className
        )}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        role="treeitem"
        aria-selected={isSelected}
        tabIndex={0}
      >
        {children ?? (
          <>
            <FileTreeIcon>
              {icon ?? <HugeiconsIcon icon={File} className="size-4 text-muted-foreground" />}
            </FileTreeIcon>
            <FileTreeName>{name}</FileTreeName>
            {(onFavorite || onAdd || onAddToLibrary) && (
              <div className="ml-auto flex items-center gap-0.5">
                {onFavorite && (
                  <button
                    type="button"
                    className="flex size-5 shrink-0 items-center justify-center rounded opacity-0 transition-opacity hover:bg-muted group-hover/file:opacity-100 focus-visible:opacity-100"
                    onClick={handleFavorite}
                    title={favorited ? t("common.removeFromFavorites") : t("common.addToFavorites")}
                  >
                    <HugeiconsIcon
                      icon={Favorite}
                      className={cn("size-3", favorited ? "text-amber-500" : "text-muted-foreground")}
                      fill={favorited ? "currentColor" : "none"}
                    />
                  </button>
                )}

                {onAdd && (
                  <button
                    type="button"
                    className="flex size-5 shrink-0 items-center justify-center rounded opacity-0 transition-opacity hover:bg-muted group-hover/file:opacity-100 focus-visible:opacity-100"
                    onClick={handleAdd}
                    title={t('common.addToChat')}
                  >
                    <HugeiconsIcon icon={Add} className="size-3 text-muted-foreground" />
                  </button>
                )}

                {onAddToLibrary && (
                  <button
                    type="button"
                    className="flex size-5 shrink-0 items-center justify-center rounded opacity-0 transition-opacity hover:bg-muted group-hover/file:opacity-100 focus-visible:opacity-100"
                    onClick={handleAddToLibrary}
                    title={t('common.addToLibrary')}
                  >
                    <HugeiconsIcon icon={BookOpen} className="size-3 text-muted-foreground" />
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </FileTreeFileContext.Provider>
  );
};

export type FileTreeIconProps = HTMLAttributes<HTMLSpanElement>;

export const FileTreeIcon = ({
  className,
  children,
  ...props
}: FileTreeIconProps) => (
  <span className={cn("shrink-0", className)} {...props}>
    {children}
  </span>
);

export type FileTreeNameProps = HTMLAttributes<HTMLSpanElement>;

export const FileTreeName = ({
  className,
  children,
  ...props
}: FileTreeNameProps) => (
  <span className={cn("truncate", className)} {...props}>
    {children}
  </span>
);

export type FileTreeActionsProps = HTMLAttributes<HTMLDivElement>;

const stopPropagation = (e: React.SyntheticEvent) => e.stopPropagation();

export const FileTreeActions = ({
  className,
  children,
  ...props
}: FileTreeActionsProps) => (
  // biome-ignore lint/a11y/noNoninteractiveElementInteractions: stopPropagation required for nested interactions
  // biome-ignore lint/a11y/useSemanticElements: fieldset doesn't fit this UI pattern
  <div
    className={cn("ml-auto flex items-center gap-1", className)}
    onClick={stopPropagation}
    onKeyDown={stopPropagation}
    role="group"
    {...props}
  >
    {children}
  </div>
);
