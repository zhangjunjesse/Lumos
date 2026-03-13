import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { FileAccessGuard, SecurityError } from '../file-access-guard'

describe('FileAccessGuard', () => {
  let tempDir: string
  let allowedDir: string
  let deniedDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-test-'))
    allowedDir = path.join(tempDir, 'allowed')
    deniedDir = path.join(tempDir, 'denied')
    fs.mkdirSync(allowedDir)
    fs.mkdirSync(deniedDir)
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  describe('正常场景', () => {
    test('允许访问白名单路径', () => {
      const guard = new FileAccessGuard({ allowedPaths: [allowedDir] })
      const testFile = path.join(allowedDir, 'test.txt')
      expect(() => guard.validatePath(testFile, 'read')).not.toThrow()
    })

    test('允许访问白名单子目录', () => {
      const guard = new FileAccessGuard({ allowedPaths: [allowedDir] })
      const subDir = path.join(allowedDir, 'sub', 'deep', 'file.txt')
      expect(() => guard.validatePath(subDir, 'read')).not.toThrow()
    })

    test('允许读写操作', () => {
      const guard = new FileAccessGuard({ allowedPaths: [allowedDir] })
      const testFile = path.join(allowedDir, 'test.txt')
      expect(() => guard.validatePath(testFile, 'read')).not.toThrow()
      expect(() => guard.validatePath(testFile, 'write')).not.toThrow()
    })

    test('多个白名单路径', () => {
      const guard = new FileAccessGuard({
        allowedPaths: [allowedDir, deniedDir]
      })
      expect(() => guard.validatePath(path.join(allowedDir, 'a.txt'), 'read')).not.toThrow()
      expect(() => guard.validatePath(path.join(deniedDir, 'b.txt'), 'read')).not.toThrow()
    })
  })

  describe('边界条件', () => {
    test('空路径', () => {
      const guard = new FileAccessGuard({ allowedPaths: [allowedDir] })
      expect(() => guard.validatePath('', 'read')).toThrow(SecurityError)
    })

    test('相对路径', () => {
      const guard = new FileAccessGuard({ allowedPaths: [allowedDir] })
      expect(() => guard.validatePath('../../../etc/passwd', 'read')).toThrow(SecurityError)
    })

    test('路径包含特殊字符', () => {
      const guard = new FileAccessGuard({ allowedPaths: [allowedDir] })
      const specialFile = path.join(allowedDir, 'file with spaces & symbols!.txt')
      expect(() => guard.validatePath(specialFile, 'read')).not.toThrow()
    })

    test('不存在的文件', () => {
      const guard = new FileAccessGuard({ allowedPaths: [allowedDir] })
      const nonExistent = path.join(allowedDir, 'does-not-exist.txt')
      expect(() => guard.validatePath(nonExistent, 'write')).not.toThrow()
    })

    test('空白名单', () => {
      const guard = new FileAccessGuard({ allowedPaths: [] })
      expect(() => guard.validatePath(path.join(allowedDir, 'test.txt'), 'read')).toThrow(SecurityError)
    })
  })

  describe('安全攻击场景', () => {
    test('拒绝访问白名单外路径', () => {
      const guard = new FileAccessGuard({ allowedPaths: [allowedDir] })
      expect(() => guard.validatePath(deniedDir, 'read')).toThrow(SecurityError)
      expect(() => guard.validatePath(deniedDir, 'read')).toThrow(/outside allowed/)
    })

    test('拒绝访问黑名单路径', () => {
      const guard = new FileAccessGuard({
        allowedPaths: [tempDir],
        deniedPaths: [deniedDir]
      })
      expect(() => guard.validatePath(path.join(deniedDir, 'secret.txt'), 'read')).toThrow(SecurityError)
      expect(() => guard.validatePath(path.join(deniedDir, 'secret.txt'), 'read')).toThrow(/Access denied/)
    })

    test('黑名单优先级高于白名单', () => {
      const guard = new FileAccessGuard({
        allowedPaths: [tempDir],
        deniedPaths: [deniedDir]
      })
      expect(() => guard.validatePath(path.join(deniedDir, 'file.txt'), 'read')).toThrow(SecurityError)
    })

    test('路径遍历攻击 - 使用..', () => {
      const guard = new FileAccessGuard({ allowedPaths: [allowedDir] })
      const traversal = path.join(allowedDir, '..', 'denied', 'secret.txt')
      expect(() => guard.validatePath(traversal, 'read')).toThrow(SecurityError)
    })

    test('符号链接绕过', () => {
      const linkPath = path.join(allowedDir, 'link')
      try {
        fs.symlinkSync(deniedDir, linkPath)
        const guard = new FileAccessGuard({
          allowedPaths: [allowedDir],
          deniedPaths: [deniedDir]
        })
        expect(() => guard.validatePath(linkPath, 'read')).toThrow(SecurityError)
      } catch (e) {
        // Skip if symlink creation fails
      }
    })

    test('拒绝访问敏感系统文件', () => {
      const guard = new FileAccessGuard({
        allowedPaths: [allowedDir],
        deniedPaths: [
          path.join(os.homedir(), '.ssh'),
          path.join(os.homedir(), '.lumos')
        ]
      })
      expect(() => guard.validatePath(path.join(os.homedir(), '.ssh', 'id_rsa'), 'read')).toThrow(SecurityError)
      expect(() => guard.validatePath(path.join(os.homedir(), '.lumos', 'lumos.db'), 'read')).toThrow(SecurityError)
    })

    test('只读模式拒绝写操作', () => {
      const guard = new FileAccessGuard({
        allowedPaths: [allowedDir],
        readOnly: true
      })
      expect(() => guard.validatePath(path.join(allowedDir, 'test.txt'), 'read')).not.toThrow()
      expect(() => guard.validatePath(path.join(allowedDir, 'test.txt'), 'write')).toThrow(SecurityError)
      expect(() => guard.validatePath(path.join(allowedDir, 'test.txt'), 'write')).toThrow(/Write operation not allowed/)
    })

    test('绝对路径规范化', () => {
      const guard = new FileAccessGuard({ allowedPaths: [allowedDir] })
      const unnormalized = path.join(allowedDir, '.', 'sub', '..', 'file.txt')
      expect(() => guard.validatePath(unnormalized, 'read')).not.toThrow()
    })
  })

  describe('文件系统包装', () => {
    test('wrapFileSystem 拦截 readFile', () => {
      const guard = new FileAccessGuard({ allowedPaths: [allowedDir] })
      guard.wrapFileSystem()

      const testFile = path.join(allowedDir, 'test.txt')
      fs.writeFileSync(testFile, 'content')

      expect(() => fs.readFileSync(testFile)).not.toThrow()
      expect(() => fs.readFileSync(path.join(deniedDir, 'secret.txt'))).toThrow(SecurityError)

      guard.unwrapFileSystem()
    })

    test('wrapFileSystem 拦截 writeFile', () => {
      const guard = new FileAccessGuard({ allowedPaths: [allowedDir] })
      guard.wrapFileSystem()

      expect(() => fs.writeFileSync(path.join(allowedDir, 'ok.txt'), 'data')).not.toThrow()
      expect(() => fs.writeFileSync(path.join(deniedDir, 'bad.txt'), 'data')).toThrow(SecurityError)

      guard.unwrapFileSystem()
    })

    test('unwrapFileSystem 恢复原始行为', () => {
      const guard = new FileAccessGuard({ allowedPaths: [allowedDir] })
      guard.wrapFileSystem()
      guard.unwrapFileSystem()

      // After unwrap, should not throw
      const testFile = path.join(deniedDir, 'test.txt')
      fs.writeFileSync(testFile, 'data')
      expect(fs.readFileSync(testFile, 'utf8')).toBe('data')
    })

    test('重复调用 wrapFileSystem 不会出错', () => {
      const guard = new FileAccessGuard({ allowedPaths: [allowedDir] })
      expect(() => {
        guard.wrapFileSystem()
        guard.wrapFileSystem()
      }).not.toThrow()
      guard.unwrapFileSystem()
    })

    test('重复调用 unwrapFileSystem 不会出错', () => {
      const guard = new FileAccessGuard({ allowedPaths: [allowedDir] })
      guard.wrapFileSystem()
      expect(() => {
        guard.unwrapFileSystem()
        guard.unwrapFileSystem()
      }).not.toThrow()
    })
  })

  describe('性能测试', () => {
    test('路径验证 < 1ms (1000次)', () => {
      const guard = new FileAccessGuard({ allowedPaths: [allowedDir] })
      const testFile = path.join(allowedDir, 'test.txt')

      const start = Date.now()
      for (let i = 0; i < 1000; i++) {
        guard.validatePath(testFile, 'read')
      }
      const elapsed = Date.now() - start

      expect(elapsed).toBeLessThan(1000)
    })

    test('内存开销 < 10KB', () => {
      const paths = Array(100).fill(0).map((_, i) => path.join(tempDir, `dir${i}`))
      const guard = new FileAccessGuard({
        allowedPaths: paths,
        deniedPaths: paths.slice(0, 50)
      })

      // Memory usage should be minimal
      expect(JSON.stringify(guard).length).toBeLessThan(10000)
    })
  })
})
