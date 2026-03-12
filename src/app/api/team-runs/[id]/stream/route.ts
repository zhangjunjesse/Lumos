import { NextRequest } from 'next/server'
import { getDb } from '@/lib/db/connection'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const encoder = new TextEncoder()
  const db = getDb()

  const stream = new ReadableStream({
    start(controller) {
      // 发送初始连接消息
      const data = `data: ${JSON.stringify({ type: 'connected', runId: params.id })}\n\n`
      controller.enqueue(encoder.encode(data))

      // 轮询数据库获取状态更新
      const interval = setInterval(() => {
        try {
          const run = db.prepare('SELECT * FROM team_runs WHERE id = ?').get(params.id) as any

          if (!run) {
            controller.close()
            clearInterval(interval)
            return
          }

          const stages = db.prepare('SELECT * FROM team_run_stages WHERE run_id = ?').all(params.id) as any[]

          const event = {
            type: 'status_update',
            runId: params.id,
            status: run.status,
            stages: stages.map(s => ({
              id: s.id,
              status: s.status,
              name: s.name
            }))
          }

          const message = `data: ${JSON.stringify(event)}\n\n`
          controller.enqueue(encoder.encode(message))

          // 如果 run 完成，关闭连接
          if (run.status === 'done' || run.status === 'failed' || run.status === 'cancelled') {
            clearInterval(interval)
            controller.close()
          }
        } catch (error) {
          console.error('SSE error:', error)
          clearInterval(interval)
          controller.close()
        }
      }, 1000) // 每秒推送一次

      // 清理
      request.signal.addEventListener('abort', () => {
        clearInterval(interval)
        controller.close()
      })
    }
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    }
  })
}
