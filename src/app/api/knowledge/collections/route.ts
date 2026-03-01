import { NextRequest, NextResponse } from 'next/server';
import * as store from '@/lib/knowledge/store';

export async function GET() {
  return NextResponse.json(store.listCollections());
}

export async function POST(req: NextRequest) {
  const { name, description } = await req.json();
  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 });
  return NextResponse.json(store.createCollection(name, description));
}
