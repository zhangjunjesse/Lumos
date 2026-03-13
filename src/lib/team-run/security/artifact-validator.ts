import { SecurityError } from './file-access-guard'

export interface ArtifactInput {
  content: Buffer | string
  contentType: string
  stageId: string
}

export class ArtifactValidator {
  static readonly MAX_SIZE = 10 * 1024 * 1024  // 10MB
  static readonly ALLOWED_TYPES = [
    'text/plain',
    'application/json',
    'text/markdown',
    'text/csv'
  ]

  static async validate(input: ArtifactInput): Promise<void> {
    const content = Buffer.isBuffer(input.content)
      ? input.content
      : Buffer.from(input.content)

    if (content.length > this.MAX_SIZE) {
      throw new SecurityError(
        `Artifact too large: ${content.length} bytes (max ${this.MAX_SIZE})`,
        'ARTIFACT_TOO_LARGE'
      )
    }

    if (!this.ALLOWED_TYPES.includes(input.contentType)) {
      throw new SecurityError(
        `Content type not allowed: ${input.contentType}`,
        'INVALID_CONTENT_TYPE'
      )
    }

    if (input.contentType.startsWith('text/')) {
      const text = content.toString('utf8')

      const maliciousPatterns = [
        /<script[^>]*>/i,
        /javascript:/i,
        /onerror\s*=/i,
        /onclick\s*=/i,
        /eval\(/i
      ]

      for (const pattern of maliciousPatterns) {
        if (pattern.test(text)) {
          throw new SecurityError(
            'Potentially malicious content detected',
            'MALICIOUS_CONTENT'
          )
        }
      }
    }
  }
}
