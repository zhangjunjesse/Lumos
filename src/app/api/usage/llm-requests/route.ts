import { NextRequest } from 'next/server'
import { listLlmRequestLogs } from '@/lib/llm-request-log'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams
    const windowHoursRaw = Number.parseInt(params.get('window_hours') || '24', 10)
    const limitRaw = Number.parseInt(params.get('limit') || '50', 10)
    const result = listLlmRequestLogs({
      windowHours: Number.isFinite(windowHoursRaw) ? windowHoursRaw : 24,
      limit: Number.isFinite(limitRaw) ? limitRaw : 50,
    })
    return Response.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch LLM request logs'
    return Response.json({ error: message }, { status: 500 })
  }
}

