import { NextRequest, NextResponse } from 'next/server'
import { getQmtSettings, setQmtSettings } from '@/lib/mesh/mesh-settings-store'

/** mesh 全局设置（qmt 数据源接入参数，所有工作室共用）。GET 读 / POST 存。 */
export async function GET() {
  return NextResponse.json({ qmt: getQmtSettings() })
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  setQmtSettings({
    qmtDir: typeof body.qmtDir === 'string' ? body.qmtDir : undefined,
    qmtPython: typeof body.qmtPython === 'string' ? body.qmtPython : undefined,
    qmtPath: typeof body.qmtPath === 'string' ? body.qmtPath : undefined,
    qmtAccountId: typeof body.qmtAccountId === 'string' ? body.qmtAccountId : undefined,
  })
  return NextResponse.json({ qmt: getQmtSettings() })
}
