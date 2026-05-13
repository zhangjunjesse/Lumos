import fs from 'fs'
import type { PathLike } from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

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

function normalizePath(filePath: string): string {
  const resolved = path.resolve(filePath)
  let existingPath = resolved
  const missingSegments: string[] = []

  try {
    while (!fs.existsSync(existingPath)) {
      const parent = path.dirname(existingPath)
      if (parent === existingPath) {
        return resolved
      }

      missingSegments.unshift(path.basename(existingPath))
      existingPath = parent
    }

    const realPath = fs.realpathSync(existingPath)
    return missingSegments.length > 0 ? path.join(realPath, ...missingSegments) : realPath
  } catch {
    return resolved
  }
}

function isSameOrChildPath(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate)
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative))
}

function pathLikeToString(filePath: PathLike): string {
  if (typeof filePath === 'string') {
    return filePath
  }

  if (Buffer.isBuffer(filePath)) {
    return filePath.toString()
  }

  return fileURLToPath(filePath)
}

type WrappedFsMethod = (...args: unknown[]) => unknown
type MutableFs = typeof fs & Record<string, WrappedFsMethod>

export class FileAccessGuard {
  private originalFs: Partial<Record<string, WrappedFsMethod>> = {}
  private isWrapped = false

  constructor(private policy: FileAccessPolicy) {
    this.policy.allowedPaths = policy.allowedPaths.map(normalizePath)
    this.policy.deniedPaths = (policy.deniedPaths || []).map(normalizePath)
  }

  validatePath(filePath: string, operation: 'read' | 'write'): void {
    if (!filePath || !filePath.trim()) {
      throw new SecurityError('Invalid file path', 'FILE_ACCESS_DENIED')
    }

    const resolved = normalizePath(filePath)

    // Check denied paths first
    for (const denied of this.policy.deniedPaths || []) {
      if (isSameOrChildPath(resolved, denied)) {
        throw new SecurityError(`Access denied: ${filePath}`, 'FILE_ACCESS_DENIED')
      }
    }

    // Check allowed paths
    const allowed = this.policy.allowedPaths.some(p => isSameOrChildPath(resolved, p))
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

    const mutableFs = fs as MutableFs
    const readMethods = ['readFile', 'readFileSync', 'readdir', 'readdirSync', 'stat', 'statSync']
    readMethods.forEach(method => {
      const originalMethod = mutableFs[method]
      this.originalFs[method] = originalMethod
      mutableFs[method] = (...args: unknown[]) => {
        this.validatePath(pathLikeToString(args[0] as PathLike), 'read')
        return originalMethod.apply(fs, args)
      }
    })

    const writeMethods = ['writeFile', 'writeFileSync', 'appendFile', 'appendFileSync', 'unlink', 'unlinkSync']
    writeMethods.forEach(method => {
      const originalMethod = mutableFs[method]
      this.originalFs[method] = originalMethod
      mutableFs[method] = (...args: unknown[]) => {
        this.validatePath(pathLikeToString(args[0] as PathLike), 'write')
        return originalMethod.apply(fs, args)
      }
    })

    this.isWrapped = true
  }

  unwrapFileSystem(): void {
    if (!this.isWrapped) return
    const mutableFs = fs as MutableFs
    Object.keys(this.originalFs).forEach(method => {
      const originalMethod = this.originalFs[method]
      if (originalMethod) {
        mutableFs[method] = originalMethod
      }
    })
    this.originalFs = {}
    this.isWrapped = false
  }

  toJSON(): Record<string, unknown> {
    return {
      allowedPathCount: this.policy.allowedPaths.length,
      deniedPathCount: this.policy.deniedPaths?.length || 0,
      readOnly: Boolean(this.policy.readOnly),
      isWrapped: this.isWrapped,
    }
  }
}
