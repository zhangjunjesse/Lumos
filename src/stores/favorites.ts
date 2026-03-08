import create from "zustand";
import { persist } from "zustand/middleware";

export type FavoriteType = "file" | "feishu-doc" | "url";

interface FavoriteBase {
  id: string;
  key: string;
  type: FavoriteType;
  title: string;
  subtitle: string;
  createdAt: number;
  updatedAt: number;
}

export interface FavoriteFileItem extends FavoriteBase {
  type: "file";
  path: string;
}

export interface FavoriteFeishuDocItem extends FavoriteBase {
  type: "feishu-doc";
  token: string;
  docType: string;
  url: string;
  updatedTime?: number;
}

export interface FavoriteUrlItem extends FavoriteBase {
  type: "url";
  url: string;
  normalizedUrl: string;
}

export type FavoriteItem =
  | FavoriteFileItem
  | FavoriteFeishuDocItem
  | FavoriteUrlItem;

interface ToggleFileInput {
  path: string;
  title?: string;
}

interface ToggleFeishuDocInput {
  token: string;
  type: string;
  title: string;
  url: string;
  updatedTime?: number;
}

interface ToggleUrlInput {
  url: string;
  title?: string;
}

interface FavoritesStore {
  items: FavoriteItem[];
  toggleFile: (input: ToggleFileInput) => boolean;
  toggleFeishuDoc: (input: ToggleFeishuDocInput) => boolean;
  toggleUrl: (input: ToggleUrlInput) => boolean;
  removeByKey: (key: string) => void;
  touchByKey: (key: string) => void;
  isFileFavorited: (path: string) => boolean;
  isFeishuDocFavorited: (token: string, type: string) => boolean;
  isUrlFavorited: (url: string) => boolean;
}

function sortByRecent(items: FavoriteItem[]): FavoriteItem[] {
  return [...items].sort((a, b) => b.updatedAt - a.updatedAt);
}

function fileNameFromPath(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts.at(-1) || path;
}

function makeFileKey(path: string): string {
  return `file:${path}`;
}

function makeFeishuKey(token: string, type: string): string {
  return `feishu-doc:${type}:${token}`;
}

function normalizeUrl(url: string): string {
  const input = url.trim();
  if (!input) return "";

  try {
    const parsed = new URL(input);
    parsed.hash = "";
    const normalized = parsed.toString();
    if (normalized.endsWith("/") && parsed.pathname === "/") {
      return normalized.slice(0, -1);
    }
    return normalized;
  } catch {
    return input;
  }
}

function makeUrlKey(url: string): string {
  return `url:${normalizeUrl(url)}`;
}

function titleFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, "") || url;
  } catch {
    return url;
  }
}

export const useFavoritesStore = create<FavoritesStore>(
  persist(
    (set, get) => ({
      items: [],

      toggleFile: ({ path, title }) => {
        const key = makeFileKey(path);
        const existing = get().items.find((item) => item.key === key);
        if (existing) {
          set((state) => ({ items: state.items.filter((item) => item.key !== key) }));
          return false;
        }

        const now = Date.now();
        const next: FavoriteFileItem = {
          id: key,
          key,
          type: "file",
          path,
          title: title || fileNameFromPath(path),
          subtitle: path,
          createdAt: now,
          updatedAt: now,
        };
        set((state) => ({ items: sortByRecent([...state.items, next]) }));
        return true;
      },

      toggleFeishuDoc: ({ token, type, title, url, updatedTime }) => {
        const key = makeFeishuKey(token, type);
        const existing = get().items.find((item) => item.key === key);
        if (existing) {
          set((state) => ({ items: state.items.filter((item) => item.key !== key) }));
          return false;
        }

        const now = Date.now();
        const next: FavoriteFeishuDocItem = {
          id: key,
          key,
          type: "feishu-doc",
          token,
          docType: type,
          title,
          subtitle: type,
          url,
          updatedTime,
          createdAt: now,
          updatedAt: now,
        };
        set((state) => ({ items: sortByRecent([...state.items, next]) }));
        return true;
      },

      toggleUrl: ({ url, title }) => {
        const normalizedUrl = normalizeUrl(url);
        if (!normalizedUrl) return false;

        const key = makeUrlKey(normalizedUrl);
        const existing = get().items.find((item) => item.key === key);
        if (existing) {
          set((state) => ({ items: state.items.filter((item) => item.key !== key) }));
          return false;
        }

        const now = Date.now();
        const next: FavoriteUrlItem = {
          id: key,
          key,
          type: "url",
          url,
          normalizedUrl,
          title: title || titleFromUrl(normalizedUrl),
          subtitle: normalizedUrl,
          createdAt: now,
          updatedAt: now,
        };
        set((state) => ({ items: sortByRecent([...state.items, next]) }));
        return true;
      },

      removeByKey: (key: string) => {
        set((state) => ({ items: state.items.filter((item) => item.key !== key) }));
      },

      touchByKey: (key: string) => {
        set((state) => {
          let matched = false;
          const updated = state.items.map((item) => {
            if (item.key !== key) {
              return item;
            }
            matched = true;
            return {
              ...item,
              updatedAt: Date.now(),
            };
          });

          if (!matched) {
            return { items: state.items };
          }
          return { items: sortByRecent(updated) };
        });
      },

      isFileFavorited: (path: string) => {
        const key = makeFileKey(path);
        return get().items.some((item) => item.key === key);
      },

      isFeishuDocFavorited: (token: string, type: string) => {
        const key = makeFeishuKey(token, type);
        return get().items.some((item) => item.key === key);
      },

      isUrlFavorited: (url: string) => {
        const key = makeUrlKey(url);
        return get().items.some((item) => item.key === key);
      },
    }),
    {
      name: "content-favorites-storage",
    }
  )
);
