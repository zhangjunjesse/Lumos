export class SafeError extends Error {
  constructor(
    public userMessage: string,
    public internalMessage: string,
    public code: string
  ) {
    super(userMessage)
  }
}

export class ErrorSanitizer {
  static sanitizeText(value: string): string {
    let message = value

    // Sanitize user paths
    message = message.replace(/\/Users\/[^/\s]+/g, '/Users/***')
    message = message.replace(/\/home\/[^/\s]+/g, '/home/***')
    message = message.replace(/C:\\Users\\[^\\]+/g, 'C:\\Users\\***')

    // Sanitize API keys
    message = message.replace(/sk-ant-[a-zA-Z0-9_-]+/g, 'sk-ant-***')
    message = message.replace(/[a-f0-9]{32,}/gi, '***')

    // Sanitize database paths
    message = message.replace(/\.lumos\/lumos\.db/g, '.lumos/***.db')

    return message
  }

  static sanitize(error: Error): SafeError {
    const message = this.sanitizeText(error.message)
    const userMessage = this.getUserFriendlyMessage(error)

    return new SafeError(userMessage, message, error.name || 'UNKNOWN_ERROR')
  }

  private static getUserFriendlyMessage(error: Error): string {
    if (error.name === 'SecurityError') {
      return 'Security policy violation'
    }
    if (error.message.includes('SQLITE')) {
      return 'Database operation failed'
    }
    if (error.message.includes('ENOENT')) {
      return 'File not found'
    }
    if (error.message.includes('EACCES')) {
      return 'Permission denied'
    }
    return 'Task execution failed'
  }
}
