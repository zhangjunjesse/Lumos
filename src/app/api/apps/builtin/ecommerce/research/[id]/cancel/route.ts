import { NextRequest, NextResponse } from 'next/server';

import { cancelReport } from '@/lib/ecommerce-assistant/research-runner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function POST(_req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const ok = cancelReport(id);
    if (!ok) {
      return NextResponse.json(
        {
          ok: false,
          note: '该报告当前未在运行（可能已完成、失败、取消或服务进程刚重启）。',
        },
        { status: 200 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
