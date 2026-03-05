import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET(
  req: NextRequest,
  { params }: { params: { binding_id: string } }
) {
  try {
    const db = getDb();
    const binding = db.prepare(
      `SELECT id, session_id as sessionId, chat_id as chatId, status, created_at as createdAt
       FROM session_bindings WHERE id = ?`
    ).get(params.binding_id);

    if (!binding) {
      return NextResponse.json({ error: 'Binding not found' }, { status: 404 });
    }

    return NextResponse.json(binding);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { binding_id: string } }
) {
  try {
    const db = getDb();
    db.prepare(
      `UPDATE session_bindings SET status = 'deleted', updated_at = datetime('now')
       WHERE id = ?`
    ).run(params.binding_id);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
