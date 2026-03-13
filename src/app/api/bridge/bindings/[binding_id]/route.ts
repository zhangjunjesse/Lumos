import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { updateSessionBindingStatus, getSessionBindingById } from '@/lib/db/feishu-bridge';

function toErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function ensureBindingMetadataColumns(db: ReturnType<typeof getDb>) {
  const columns = db.prepare('PRAGMA table_info(session_bindings)').all() as Array<{ name: string }>;
  const names = new Set(columns.map((column) => column.name));

  if (!names.has('platform_chat_name')) {
    db.exec("ALTER TABLE session_bindings ADD COLUMN platform_chat_name TEXT NOT NULL DEFAULT ''");
  }

  if (!names.has('share_link')) {
    db.exec("ALTER TABLE session_bindings ADD COLUMN share_link TEXT NOT NULL DEFAULT ''");
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ binding_id: string }> }
) {
  const { binding_id } = await params;
  try {
    const db = getDb();
    ensureBindingMetadataColumns(db);
    const binding = db.prepare(
      `SELECT
         id,
         lumos_session_id as session_id,
         lumos_session_id as sessionId,
         platform,
         platform_chat_id,
         platform_chat_id as chatId,
         platform_chat_name,
         share_link,
         status,
         created_at,
         created_at as createdAt,
         updated_at
       FROM session_bindings WHERE id = ?`
    ).get(binding_id);

    if (!binding) {
      return NextResponse.json({ error: 'Binding not found' }, { status: 404 });
    }

    return NextResponse.json(binding);
  } catch (error: unknown) {
    return NextResponse.json({ error: toErrorMessage(error, 'Failed to load binding') }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ binding_id: string }> }
) {
  const { binding_id } = await params;
  try {
    const { status } = await req.json();

    if (!['active', 'inactive', 'expired'].includes(status)) {
      return NextResponse.json(
        { error: 'Invalid status', code: 'INVALID_PARAMETER' },
        { status: 400 }
      );
    }

    updateSessionBindingStatus(parseInt(binding_id), status as 'active' | 'inactive' | 'expired');
    const binding = getSessionBindingById(parseInt(binding_id));

    return NextResponse.json({
      success: true,
      binding,
    });
  } catch {
    return NextResponse.json(
      { error: 'Failed to update binding', code: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ binding_id: string }> }
) {
  const { binding_id } = await params;
  try {
    const db = getDb();
    db.prepare(
      `UPDATE session_bindings SET status = 'deleted', updated_at = datetime('now')
       WHERE id = ?`
    ).run(binding_id);
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    return NextResponse.json({ error: toErrorMessage(error, 'Failed to delete binding') }, { status: 500 });
  }
}
