import { SecurityError } from './file-access-guard'

export class SQLValidator {
  private static readonly ID_PATTERN = /^[a-zA-Z0-9_-]{8,64}$/

  static validateId(id: string, fieldName: string = 'id'): void {
    if (!this.ID_PATTERN.test(id)) {
      throw new SecurityError(
        `Invalid ${fieldName} format`,
        'INVALID_ID_FORMAT'
      )
    }
  }

  static validateQuery(sql: string): void {
    if (sql.includes('${') || sql.includes('`')) {
      throw new SecurityError(
        'Template literals not allowed in SQL',
        'SQL_INJECTION_ATTEMPT'
      )
    }

    if (sql.includes('+') && sql.includes("'")) {
      throw new SecurityError(
        'String concatenation not allowed in SQL',
        'SQL_INJECTION_ATTEMPT'
      )
    }

    // Check for SQL injection keywords in non-parameterized context
    const dangerousPatterns = [
      /;\s*(DROP|DELETE|UPDATE|INSERT|ALTER|CREATE)\s/i,
      /UNION\s+(ALL\s+)?SELECT/i,
      /--/,
      /\/\*/,
      /\bOR\b.*=.*\bOR\b/i,
      /\bAND\b.*=.*\bAND\b/i
    ]

    for (const pattern of dangerousPatterns) {
      if (pattern.test(sql)) {
        throw new SecurityError(
          'Potentially dangerous SQL pattern detected',
          'SQL_INJECTION_ATTEMPT'
        )
      }
    }
  }

  static async safeQuery<T>(
    db: any,
    sql: string,
    params: any[]
  ): Promise<T[]> {
    this.validateQuery(sql)
    return db.all(sql, params)
  }
}
