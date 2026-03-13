import * as fs from 'fs'
import * as path from 'path'

export class SecurityError extends Error {
  constructor(message: string, public code: string = 'SECURITY_VIOLATION') {
    super(message)
    this.name = 'SecurityError'
  }
}

export interface FileAccessPolicy {
  allowedPaths: string[]
  deniedPaths?: string[]
  readOnly?: boolean
}

export class FileAccessGuard {
  private originalFs: Record<string, Function> = {}
  private isWrapped = false

  constructor(private policy: FileAccessPolicy) {
    this.policy.allowedPaths = policy.allowedPaths.map(p => path.resolve(p))
    this.policy.deniedPaths = (policy.deniedPaths || []).map(p => path.resolve(p))
  }

  validatePath(filePath: string, operation: 'read' | 'write'): void {
    if (!filePath || !filePath.trim()) {
      throw new SecurityError('Invalid file path', 'FILE_ACCESS_DENIED')
    }

    let resolved: string
    try {
      resolved = fs.existsSync(filePath) ? fs.realpathSync(filePath) : path.resolve(filePath)
    } catch {
      resolved = path.resolve(filePath)
    }

    // Check denied paths first
    for (const denied of this.policy.deniedPaths || []) {
      if (resolved.startsWith(denied)) {
        throw new SecurityError(`Access denied: ${filePath}`, 'FILE_ACCESS_DENIED')
      }
    }

    // Check allowed paths
    const allowed = this.policy.allowedPaths.some(p => resolved.startsWith(p))
    if (!allowed) {
      throw new SecurityError(`Path outside allowed directories: ${filePath}`, 'FILE_ACCESS_DENIED')
    }

    // Check read-only restriction
    if (operation === 'write' && this.policy.readOnly) {
      throw new SecurityError('Write operation not allowed', 'FILE_WRITE_DENIED')
    }
  }

  wrapFileSystem(): void {
    if (this.isWrapped) return

    const readMethods = ['readFile', 'readFileSync', 'readdir', 'readdirSync', 'stat', 'statSync']
    readMethods.forEach(method => {
      this.originalFs[method] = (fs as any)[method]
      ;(fs as any)[method] = (...args: any[]) => {
        this.validatePath(args[0], 'read')
        return this.originalFs[method].apply(fs, args)
      }
    })

    const writeMethods = ['writeFile', 'writeFileSync', 'appendFile', 'appendFileSync', 'unlink', 'unlinkSync']
    writeMethods.forEach(method => {
      this.originalFs[method] = (fs as any)[method]
      ;(fs as any)[method] = (...args: any[]) => {
        this.validatePath(args[0], 'write')
        return this.originalFs[method].apply(fs, args)
      }
    })

    this.isWrapped = true
  }

  unwrapFileSystem(): void {
    if (!this.isWrapped) return
    Object.keys(this.originalFs).forEach(method => {
      ;(fs as any)[method] = this.originalFs[method]
    })
    this.originalFs = {}
    this.isWrapped = false
  }
}
