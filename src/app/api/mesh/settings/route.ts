import { NextRequest, NextResponse } from 'next/server'
import { getQmtSettings, setQmtSettings, getAssistantSettings, setAssistantSettings } from '@/lib/mesh/mesh-settings-store'

/** mesh 全局设置（qmt 数据源 + 团队管家模型，所有工作室共用）。GET 读 / POST 存。 */
export async function GET() {
  return NextResponse.json({ qmt: getQmtSettings(), assistant: getAssistantSettings() })
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  setQmtSettings({
    qmtDir: typeof body.qmtDir === 'string' ? body.qmtDir : undefined,
    qmtPython: typeof body.qmtPython === 'string' ? body.qmtPython : undefined,
    qmtPath: typeof body.qmtPath === 'string' ? body.qmtPath : undefined,
    qmtAccountId: typeof body.qmtAccountId === 'string' ? body.qmtAccountId : undefined,
  })
  setAssistantSettings({
    providerId: typeof body.assistantProviderId === 'string' ? body.assistantProviderId : undefined,
    model: typeof body.assistantModel === 'string' ? body.assistantModel : undefined,
  })
  return NextResponse.json({ qmt: getQmtSettings(), assistant: getAssistantSettings() })
}
