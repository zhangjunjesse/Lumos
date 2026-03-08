import * as store from './store';
import type { KbCollection } from './types';

export const DEFAULT_COLLECTION_NAME = 'Default';

export function ensureDefaultCollection(): KbCollection {
  const collections = store.listCollections();
  if (collections.length === 0) {
    return store.createCollection(DEFAULT_COLLECTION_NAME, 'Auto-created');
  }

  const existing = collections.find((col) => col.name === DEFAULT_COLLECTION_NAME);
  return existing ?? collections[0];
}

export function ensureDefaultCollectionId(): string {
  return ensureDefaultCollection().id;
}
