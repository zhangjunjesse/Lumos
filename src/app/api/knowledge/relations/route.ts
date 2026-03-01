import { NextRequest, NextResponse } from 'next/server';
import { getRelationsForItem } from '@/lib/knowledge/relation-finder';
import * as relationStore from '@/lib/stores/relation-store';

export async function GET(req: NextRequest) {
  const itemId = req.nextUrl.searchParams.get('item_id');
  const type = req.nextUrl.searchParams.get('type');

  if (itemId) {
    const relations = getRelationsForItem(itemId);
    if (type) {
      return NextResponse.json(relations.filter(r => r.relationType === type));
    }
    return NextResponse.json(relations);
  }

  // No item_id: return all relations from store
  const all = relationStore.getRelationsForItem('');
  return NextResponse.json(all);
}
