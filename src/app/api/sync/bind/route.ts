import { NextRequest, NextResponse } from 'next/server';
import { BindingService } from '@/lib/bridge/sync/binding-service';
import { getDb } from '@/lib/db';

export async function POST(req: NextRequest) {
  try {
    const { sessionId, sessionTitle } = await req.json();
    if (!sessionId || !sessionTitle) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }
    const db = getDb();
    const feishuClient = {}; // TODO: get from feishu module
    const service = new BindingService(db, feishuClient);
    const result = await service.createBinding(sessionId, sessionTitle);
    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
