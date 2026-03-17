import {
  MAX_RUNTIME_ARTIFACT_EMBED_PREVIEW_BYTES,
  MAX_RUNTIME_ARTIFACT_TEXT_PREVIEW_BYTES,
  getRuntimeArtifactPreviewKind,
  normalizeRuntimeArtifactPreviewContent,
  parseRuntimeArtifactCsv,
} from '../runtime-artifact-preview'

describe('runtime-artifact-preview', () => {
  test('detects markdown, json, text, csv, image, and pdf previews from content type and source path', () => {
    expect(getRuntimeArtifactPreviewKind({
      contentType: 'text/markdown; charset=utf-8',
      size: 128,
      sourcePath: 'report.md',
    })).toBe('markdown')

    expect(getRuntimeArtifactPreviewKind({
      contentType: 'application/problem+json',
      size: 128,
      sourcePath: 'report.txt',
    })).toBe('json')

    expect(getRuntimeArtifactPreviewKind({
      contentType: 'application/octet-stream',
      size: 128,
      sourcePath: 'runtime.log',
    })).toBe('text')

    expect(getRuntimeArtifactPreviewKind({
      contentType: 'application/octet-stream',
      size: 128,
      sourcePath: 'report.csv',
    })).toBe('csv')

    expect(getRuntimeArtifactPreviewKind({
      contentType: 'image/png',
      size: 128,
      sourcePath: 'diagram.bin',
    })).toBe('image')

    expect(getRuntimeArtifactPreviewKind({
      contentType: 'application/octet-stream',
      size: 128,
      sourcePath: 'report.pdf',
    })).toBe('pdf')
  })

  test('rejects oversized text and embed artifacts for inline preview', () => {
    expect(getRuntimeArtifactPreviewKind({
      contentType: 'image/png',
      size: MAX_RUNTIME_ARTIFACT_EMBED_PREVIEW_BYTES + 1,
      sourcePath: 'huge.png',
    })).toBeNull()

    expect(getRuntimeArtifactPreviewKind({
      contentType: 'application/pdf',
      size: MAX_RUNTIME_ARTIFACT_EMBED_PREVIEW_BYTES + 1,
      sourcePath: 'report.pdf',
    })).toBeNull()

    expect(getRuntimeArtifactPreviewKind({
      contentType: 'text/plain',
      size: MAX_RUNTIME_ARTIFACT_TEXT_PREVIEW_BYTES + 1,
      sourcePath: 'large.log',
    })).toBeNull()
  })

  test('parses csv rows including quoted fields and embedded newlines', () => {
    expect(parseRuntimeArtifactCsv('name,notes\nalice,"hello, ""world"""')).toEqual([
      ['name', 'notes'],
      ['alice', 'hello, "world"'],
    ])

    expect(parseRuntimeArtifactCsv('id,body\r\n1,"line 1\nline 2"\r\n2,done')).toEqual([
      ['id', 'body'],
      ['1', 'line 1\nline 2'],
      ['2', 'done'],
    ])
  })

  test('pretty prints valid json preview content and leaves invalid json unchanged', () => {
    expect(normalizeRuntimeArtifactPreviewContent('{"ok":true,"count":2}', 'json')).toBe('{\n  "ok": true,\n  "count": 2\n}\n')
    expect(normalizeRuntimeArtifactPreviewContent('{oops', 'json')).toBe('{oops')
    expect(normalizeRuntimeArtifactPreviewContent('# Title', 'markdown')).toBe('# Title')
  })
})
