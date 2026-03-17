import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db/connection'

interface RouteContext {
  params: Promise<{ id: string; artifactId: string }>
}

interface ArtifactRow {
  id: string
  run_id: string
  title: string
  source_path: string | null
  content: Buffer
  content_type: string
  size: number
}

function buildFilename(artifact: ArtifactRow): string {
  const sourceName = artifact.source_path?.split('/').pop()?.trim()
  if (sourceName) {
    return sourceName
  }

  const title = artifact.title.trim().replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '')
  return title || `${artifact.id}.bin`
}

function buildContentDisposition(filename: string, download: boolean): string {
  const disposition = download ? 'attachment' : 'inline'
  const asciiFallback = filename.replace(/[^ -~]+/g, '_').replace(/"/g, '')
  const encoded = encodeURIComponent(filename)
  return `${disposition}; filename="${asciiFallback || 'artifact.bin'}"; filename*=UTF-8''${encoded}`
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { id, artifactId } = await context.params
    const db = getDb()
    const artifact = db.prepare(`
      SELECT id, run_id, title, source_path, content, content_type, size
      FROM team_run_artifacts
      WHERE id = ? AND run_id = ?
      LIMIT 1
    `).get(artifactId, id) as ArtifactRow | undefined

    if (!artifact) {
      return NextResponse.json(
        { error: 'Artifact not found' },
        { status: 404 },
      )
    }

    const download = request.nextUrl.searchParams.get('download') === '1'
    const filename = buildFilename(artifact)
    const body = Buffer.isBuffer(artifact.content)
      ? artifact.content
      : Buffer.from(artifact.content)

    return new NextResponse(new Uint8Array(body), {
      status: 200,
      headers: {
        'Content-Type': artifact.content_type || 'application/octet-stream',
        'Content-Length': String(artifact.size || body.length),
        'Content-Disposition': buildContentDisposition(filename, download),
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (error) {
    console.error('Get team run artifact error:', error)
    return NextResponse.json(
      { error: 'Failed to load team run artifact' },
      { status: 500 },
    )
  }
}
