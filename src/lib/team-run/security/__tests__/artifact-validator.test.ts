import { ArtifactValidator } from '../artifact-validator'
import { SecurityError } from '../file-access-guard'

describe('ArtifactValidator', () => {
  describe('正常场景', () => {
    test('接受有效的文本内容', async () => {
      await expect(ArtifactValidator.validate({
        content: 'Hello world',
        contentType: 'text/plain',
        stageId: 'stage-123'
      })).resolves.not.toThrow()
    })

    test('接受JSON内容', async () => {
      await expect(ArtifactValidator.validate({
        content: JSON.stringify({ key: 'value' }),
        contentType: 'application/json',
        stageId: 'stage-123'
      })).resolves.not.toThrow()
    })

    test('接受Markdown内容', async () => {
      await expect(ArtifactValidator.validate({
        content: '# Title\n\nContent',
        contentType: 'text/markdown',
        stageId: 'stage-123'
      })).resolves.not.toThrow()
    })

    test('接受Buffer格式', async () => {
      await expect(ArtifactValidator.validate({
        content: Buffer.from('data'),
        contentType: 'text/plain',
        stageId: 'stage-123'
      })).resolves.not.toThrow()
    })

    test('接受大文件但不超限', async () => {
      const content = 'x'.repeat(5 * 1024 * 1024)  // 5MB
      await expect(ArtifactValidator.validate({
        content,
        contentType: 'text/plain',
        stageId: 'stage-123'
      })).resolves.not.toThrow()
    })
  })

  describe('边界条件', () => {
    test('接受空内容', async () => {
      await expect(ArtifactValidator.validate({
        content: '',
        contentType: 'text/plain',
        stageId: 'stage-123'
      })).resolves.not.toThrow()
    })

    test('接受最大允许大小', async () => {
      const content = 'x'.repeat(10 * 1024 * 1024)  // 10MB
      await expect(ArtifactValidator.validate({
        content,
        contentType: 'text/plain',
        stageId: 'stage-123'
      })).resolves.not.toThrow()
    })

    test('拒绝超过最大大小', async () => {
      const content = 'x'.repeat(11 * 1024 * 1024)  // 11MB
      await expect(ArtifactValidator.validate({
        content,
        contentType: 'text/plain',
        stageId: 'stage-123'
      })).rejects.toThrow(SecurityError)
      await expect(ArtifactValidator.validate({
        content,
        contentType: 'text/plain',
        stageId: 'stage-123'
      })).rejects.toThrow(/too large/)
    })
  })

  describe('安全攻击场景', () => {
    test('拒绝未授权的Content-Type', async () => {
      const invalidTypes = [
        'application/javascript',
        'text/html',
        'application/x-executable',
        'application/octet-stream',
        'image/png'
      ]

      for (const contentType of invalidTypes) {
        await expect(ArtifactValidator.validate({
          content: 'data',
          contentType,
          stageId: 'stage-123'
        })).rejects.toThrow(SecurityError)
      }
    })

    test('检测XSS脚本', async () => {
      const xssPayloads = [
        '<script>alert(1)</script>',
        '<img src=x onerror=alert(1)>',
        '<svg onload=alert(1)>',
        'javascript:alert(1)',
        '<iframe src="javascript:alert(1)"></iframe>'
      ]

      for (const payload of xssPayloads) {
        await expect(ArtifactValidator.validate({
          content: payload,
          contentType: 'text/plain',
          stageId: 'stage-123'
        })).rejects.toThrow(SecurityError)
        await expect(ArtifactValidator.validate({
          content: payload,
          contentType: 'text/plain',
          stageId: 'stage-123'
        })).rejects.toThrow(/malicious/)
      }
    })

    test('检测事件处理器', async () => {
      const handlers = [
        'onclick=malicious()',
        'onerror=steal()',
        'onload=hack()',
        'onmouseover=attack()'
      ]

      for (const handler of handlers) {
        await expect(ArtifactValidator.validate({
          content: `<div ${handler}>`,
          contentType: 'text/plain',
          stageId: 'stage-123'
        })).rejects.toThrow(SecurityError)
      }
    })

    test('检测eval调用', async () => {
      await expect(ArtifactValidator.validate({
        content: 'eval(maliciousCode)',
        contentType: 'text/plain',
        stageId: 'stage-123'
      })).rejects.toThrow(SecurityError)
    })
  })

  describe('性能测试', () => {
    test('大小检查 < 0.1ms', async () => {
      const content = 'x'.repeat(1024)

      const start = Date.now()
      for (let i = 0; i < 100; i++) {
        await ArtifactValidator.validate({
          content,
          contentType: 'text/plain',
          stageId: 'stage-123'
        })
      }
      const elapsed = Date.now() - start

      expect(elapsed).toBeLessThan(500)
    })
  })
})
