import { SQLValidator } from '../sql-validator'
import { SecurityError } from '../file-access-guard'

describe('SQLValidator', () => {
  describe('正常场景', () => {
    test('接受有效的ID格式', () => {
      const validIds = [
        'abc12345',
        'stage-123',
        'run_456',
        'UPPERCASE',
        'MixedCase123',
        'a1b2c3d4e5f6g7h8'
      ]

      validIds.forEach(id => {
        expect(() => SQLValidator.validateId(id)).not.toThrow()
      })
    })

    test('接受不同字段名', () => {
      expect(() => SQLValidator.validateId('valid123', 'stageId')).not.toThrow()
      expect(() => SQLValidator.validateId('valid123', 'runId')).not.toThrow()
      expect(() => SQLValidator.validateId('valid123', 'userId')).not.toThrow()
    })

    test('接受参数化查询', () => {
      const validQueries = [
        'SELECT * FROM users WHERE id = ?',
        'UPDATE stages SET status = ? WHERE id = ?',
        'INSERT INTO runs (id, name) VALUES (?, ?)',
        'DELETE FROM artifacts WHERE stage_id = ?'
      ]

      validQueries.forEach(sql => {
        expect(() => SQLValidator.validateQuery(sql)).not.toThrow()
      })
    })

    test('safeQuery 执行参数化查询', async () => {
      const mockDb = {
        all: jest.fn().mockResolvedValue([{ id: 1, name: 'test' }])
      }

      const result = await SQLValidator.safeQuery(
        mockDb,
        'SELECT * FROM users WHERE id = ?',
        ['user-123']
      )

      expect(mockDb.all).toHaveBeenCalledWith(
        'SELECT * FROM users WHERE id = ?',
        ['user-123']
      )
      expect(result).toEqual([{ id: 1, name: 'test' }])
    })
  })

  describe('边界条件', () => {
    test('拒绝空ID', () => {
      expect(() => SQLValidator.validateId('')).toThrow(SecurityError)
      expect(() => SQLValidator.validateId('')).toThrow(/Invalid.*format/)
    })

    test('拒绝过短ID (< 8字符)', () => {
      expect(() => SQLValidator.validateId('short')).toThrow(SecurityError)
      expect(() => SQLValidator.validateId('a1b2c3')).toThrow(SecurityError)
    })

    test('拒绝过长ID (> 64字符)', () => {
      const longId = 'a'.repeat(65)
      expect(() => SQLValidator.validateId(longId)).toThrow(SecurityError)
    })

    test('接受边界长度ID', () => {
      const minId = 'a'.repeat(8)
      const maxId = 'a'.repeat(64)
      expect(() => SQLValidator.validateId(minId)).not.toThrow()
      expect(() => SQLValidator.validateId(maxId)).not.toThrow()
    })

    test('拒绝包含空格的ID', () => {
      expect(() => SQLValidator.validateId('id with spaces')).toThrow(SecurityError)
    })

    test('拒绝包含特殊字符的ID', () => {
      const invalidIds = [
        'id@domain',
        'id#123',
        'id$var',
        'id%20',
        'id&param',
        'id*wildcard',
        'id(param)',
        'id[0]',
        'id{key}',
        'id|pipe',
        'id\\backslash',
        'id/slash',
        'id:colon',
        'id;semicolon',
        'id"quote',
        "id'quote",
        'id<tag>',
        'id=value',
        'id?query',
        'id.dot',
        'id,comma'
      ]

      invalidIds.forEach(id => {
        expect(() => SQLValidator.validateId(id)).toThrow(SecurityError)
      })
    })
  })

  describe('SQL注入攻击场景', () => {
    test('拒绝经典SQL注入', () => {
      const injections = [
        "x' OR '1'='1",
        "x' OR 1=1--",
        "x'; DROP TABLE users--",
        "x' UNION SELECT * FROM passwords--",
        "admin'--",
        "' OR ''='",
        "1' AND '1'='1"
      ]

      injections.forEach(id => {
        expect(() => SQLValidator.validateId(id)).toThrow(SecurityError)
      })
    })

    test('拒绝模板字符串', () => {
      const queries = [
        'SELECT * FROM users WHERE id = ${userId}',
        'UPDATE stages SET name = `${name}`',
        'INSERT INTO runs VALUES (${id}, ${name})'
      ]

      queries.forEach(sql => {
        expect(() => SQLValidator.validateQuery(sql)).toThrow(SecurityError)
        expect(() => SQLValidator.validateQuery(sql)).toThrow(/Template literals/)
      })
    })

    test('拒绝字符串拼接', () => {
      const queries = [
        "SELECT * FROM users WHERE id = '" + "userId" + "'",
        "UPDATE stages SET name = 'test' + 'value'",
        "DELETE FROM runs WHERE id = 'run' + '123'"
      ]

      queries.forEach(sql => {
        expect(() => SQLValidator.validateQuery(sql)).toThrow(SecurityError)
        expect(() => SQLValidator.validateQuery(sql)).toThrow(/String concatenation/)
      })
    })

    test('拒绝注释符号', () => {
      const ids = [
        'id--comment',
        'id/*comment*/',
        'id#comment'
      ]

      ids.forEach(id => {
        expect(() => SQLValidator.validateId(id)).toThrow(SecurityError)
      })
    })

    test('拒绝多语句注入', () => {
      const ids = [
        'id; DROP TABLE users',
        'id; DELETE FROM stages',
        'id; UPDATE runs SET status = "hacked"'
      ]

      ids.forEach(id => {
        expect(() => SQLValidator.validateId(id)).toThrow(SecurityError)
      })
    })

    test('拒绝UNION注入', () => {
      const ids = [
        'id UNION SELECT password FROM users',
        'id UNION ALL SELECT * FROM secrets'
      ]

      ids.forEach(id => {
        expect(() => SQLValidator.validateId(id)).toThrow(SecurityError)
      })
    })

    test('拒绝时间盲注', () => {
      const ids = [
        "id' AND SLEEP(5)--",
        "id' WAITFOR DELAY '00:00:05'--",
        "id' AND BENCHMARK(1000000,MD5('A'))--"
      ]

      ids.forEach(id => {
        expect(() => SQLValidator.validateId(id)).toThrow(SecurityError)
      })
    })

    test('拒绝布尔盲注', () => {
      const ids = [
        "id' AND 1=1--",
        "id' AND 1=2--",
        "id' AND SUBSTRING(password,1,1)='a'--"
      ]

      ids.forEach(id => {
        expect(() => SQLValidator.validateId(id)).toThrow(SecurityError)
      })
    })
  })

  describe('safeQuery 安全性', () => {
    test('拒绝不安全的查询', async () => {
      const mockDb = { all: jest.fn() }

      await expect(
        SQLValidator.safeQuery(mockDb, 'SELECT * FROM users WHERE id = ${id}', [])
      ).rejects.toThrow(SecurityError)

      expect(mockDb.all).not.toHaveBeenCalled()
    })

    test('验证查询后再执行', async () => {
      const mockDb = {
        all: jest.fn().mockResolvedValue([])
      }

      await SQLValidator.safeQuery(
        mockDb,
        'SELECT * FROM users WHERE id = ?',
        ['user-123']
      )

      expect(mockDb.all).toHaveBeenCalled()
    })

    test('传递正确的参数', async () => {
      const mockDb = {
        all: jest.fn().mockResolvedValue([])
      }

      const params = ['param1', 'param2', 'param3']
      await SQLValidator.safeQuery(
        mockDb,
        'INSERT INTO table (a, b, c) VALUES (?, ?, ?)',
        params
      )

      expect(mockDb.all).toHaveBeenCalledWith(
        'INSERT INTO table (a, b, c) VALUES (?, ?, ?)',
        params
      )
    })
  })

  describe('性能测试', () => {
    test('ID验证 < 0.1ms (1000次)', () => {
      const start = Date.now()
      for (let i = 0; i < 1000; i++) {
        SQLValidator.validateId('valid-id-123')
      }
      const elapsed = Date.now() - start

      expect(elapsed).toBeLessThan(100)
    })

    test('查询验证 < 0.1ms (1000次)', () => {
      const sql = 'SELECT * FROM users WHERE id = ?'

      const start = Date.now()
      for (let i = 0; i < 1000; i++) {
        SQLValidator.validateQuery(sql)
      }
      const elapsed = Date.now() - start

      expect(elapsed).toBeLessThan(100)
    })

    test('批量ID验证性能', () => {
      const ids = Array(1000).fill(0).map((_, i) => `id-${i}`)

      const start = Date.now()
      ids.forEach(id => SQLValidator.validateId(id))
      const elapsed = Date.now() - start

      expect(elapsed).toBeLessThan(200)
    })
  })
})
