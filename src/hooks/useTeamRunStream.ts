import { useEffect, useState } from 'react'

interface TeamRunStreamEvent {
  type: 'connected' | 'status_update'
  runId: string
  status?: string
  stages?: Array<{
    id: string
    status: string
    name: string
  }>
}

export function useTeamRunStream(runId: string | null) {
  const [status, setStatus] = useState<string>('pending')
  const [stages, setStages] = useState<any[]>([])
  const [isConnected, setIsConnected] = useState(false)

  useEffect(() => {
    if (!runId) return

    const eventSource = new EventSource(`/api/team-runs/${runId}/stream`)

    eventSource.onmessage = (event) => {
      const data: TeamRunStreamEvent = JSON.parse(event.data)

      if (data.type === 'connected') {
        setIsConnected(true)
      } else if (data.type === 'status_update') {
        if (data.status) setStatus(data.status)
        if (data.stages) setStages(data.stages)
      }
    }

    eventSource.onerror = () => {
      setIsConnected(false)
      eventSource.close()
    }

    return () => {
      eventSource.close()
    }
  }, [runId])

  return { status, stages, isConnected }
}
