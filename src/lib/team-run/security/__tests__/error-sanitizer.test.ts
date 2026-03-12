import { ErrorSanitizer, SafeError } from '../error-sanitizer'

describe('ErrorSanitizer', () => {
  describe('正常场景', () => {
    test('返回SafeError对象', () => {
      const error = new Error('Test error')
      const result = ErrorSanitizer.sanitize(error)

      expect(result).toBeInstanceOf(SafeError)
      expect(result.userMessage).toBeDefined()
      expect(result.internalMessage).toBeDefined()
      expect(result.code).toBeDefined()
    })

    test('保留内部消息用于日志', () => {
      const error = new Error('Detailed internal error')
      const result = ErrorSanitizer.sanitize(error)

      expect(result.internalMessage).toContain('internal')
    })
  })

  describe('路径脱敏', () => {
    test('脱敏macOS用户路径', () => {
      const error = new Error('Failed at /Users/admin/.lumos/lumos.db')
      const result = ErrorSanitizer.sanitize(error)

      expect(result.userMessage).not.toContain('/Users/admin')
      expect(result.userMessage).toContain('/Users/***')
    })

    test('脱敏Linux用户路径', () => {
      const error = new Error('Error in /home/user/.ssh/id_rsa')
      const result = ErrorSanitizer.sanitize(error)

      expect(result.userMessage).not.toContain('/home/user')
      expect(result.userMessage).toContain('/home/***')
    })

    test('脱敏Windows用户路径', () => {
      const error = new Error('Failed at C:\\Users\\Admin\\Documents')
      const result = ErrorSanitizer.sanitize(error)

      expect(result.userMessage).not.toContain('Admin')
      expect(result.userMessage).toContain('C:\\Users\\***')
    })

    test('脱敏数据库路径', () => {
      const error = new Error('Cannot open .lumos/lumos.db')
      const result = ErrorSanitizer.sanitize(error)

      expect(result.userMessage).not.toContain('lumos.db')
      expect(result.userMessage).toContain('***.db')
    })
  })

  describe('密钥脱敏', () => {
    test('脱敏Anthropic API密钥', () => {
      const error = new Error('Invalid key: sk-ant-abc123xyz')
      const result = ErrorSanitizer.sanitize(error)

      expect(result.userMessage).not.toContain('sk-ant-abc123xyz')
      expect(result.userMessage).toContain('sk-ant-***')
    })

    test('脱敏长哈希值', () => {
      const error = new Error('Hash mismatch: a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6')
      const result = ErrorSanitizer.sanitize(error)

      expect(result.userMessage).not.toContain('a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6')
      expect(result.userMessage).toContain('***')
    })
  })

  describe('用户友好消息', () => {
    test('SecurityError转换为通用消息', () => {
      const error = new Error('Access denied: /Users/admin/.ssh/id_rsa')
      error.name = 'SecurityError'
      const result = ErrorSanitizer.sanitize(error)

      expect(result.userMessage).toBe('Security policy violation')
    })

    test('SQLITE错误转换为通用消息', () => {
      const error = new Error('SQLITE_ERROR: table not found')
      const result = ErrorSanitizer.sanitize(error)

      expect(result.userMessage).toBe('Database operation failed')
    })

    test('ENOENT转换为通用消息', () => {
      const error = new Error('ENOENT: no such file')
      const result = ErrorSanitizer.sanitize(error)

      expect(result.userMessage).toBe('File not found')
    })

    test('EACCES转换为通用消息', () => {
      const error = new Error('EACCES: permission denied')
      const result = ErrorSanitizer.sanitize(error)

      expect(result.userMessage).toBe('Permission denied')
    })

    test('未知错误使用默认消息', () => {
      const error = new Error('Some random error')
      const result = ErrorSanitizer.sanitize(error)

      expect(result.userMessage).toBe('Task execution failed')
    })
  })

  describe('性能测试', () => {
    test('错误脱敏 < 1ms (100次)', () => {
      const error = new Error('Error at /Users/admin/.lumos/lumos.db with key sk-ant-abc123')

      const start = Date.now()
      for (let i = 0; i < 100; i++) {
        ErrorSanitizer.sanitize(error)
      }
      const elapsed = Date.now() - start

      expect(elapsed).toBeLessThan(100)
    })
  })
})
