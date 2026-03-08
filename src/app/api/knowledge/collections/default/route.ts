import { NextResponse } from 'next/server';
import { ensureDefaultCollection } from '@/lib/knowledge/default-collection';

export async function GET() {
  return NextResponse.json(ensureDefaultCollection());
}
