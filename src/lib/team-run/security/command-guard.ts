import { SecurityError } from './file-access-guard'

export interface CommandPolicy {
  allowedCommands: string[]
  deniedPatterns?: RegExp[]
}

export class CommandGuard {
  static readonly ALLOW_ANY = '*'
  static readonly DEFAULT_ALLOWED = [
    'git', 'npm', 'node', 'cat', 'ls', 'grep', 'find', 'echo', 'pwd'
  ]

  private static readonly DANGEROUS_PATTERNS = [
    /rm\s+-rf/,
    /curl.*\|/,
    /wget.*\|/,
    /nc\s+-e/,
    /bash\s+-c/,
    /eval/,
    />\s*\/dev/,
    /&&/,
    /\|\|/,
    /;/
  ]

  constructor(private policy: CommandPolicy) {}

  validateCommand(cmd: string): void {
    const trimmed = cmd.trim()
    if (!trimmed) {
      throw new SecurityError('Empty command not allowed', 'COMMAND_NOT_ALLOWED')
    }

    const binary = trimmed.split(/\s+/)[0]
    const allowAny = this.policy.allowedCommands.includes(CommandGuard.ALLOW_ANY)

    if (!allowAny && !this.policy.allowedCommands.includes(binary)) {
      throw new SecurityError(
        `Command not allowed: ${binary}`,
        'COMMAND_NOT_ALLOWED'
      )
    }

    for (const pattern of CommandGuard.DANGEROUS_PATTERNS) {
      if (pattern.test(cmd)) {
        throw new SecurityError(
          'Dangerous command pattern detected',
          'DANGEROUS_COMMAND'
        )
      }
    }

    if (this.policy.deniedPatterns) {
      for (const pattern of this.policy.deniedPatterns) {
        if (pattern.test(cmd)) {
          throw new SecurityError(
            'Command matches denied pattern',
            'COMMAND_DENIED'
          )
        }
      }
    }
  }
}
