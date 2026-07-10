/**
 * setXMcpEnabled 幂等:已是目标状态不写库;需翻转才调 toggle;记录不存在返回 false。
 */
describe('mcp-toggle.setXMcpEnabled', () => {
  let getMcpServerByNameAndScope: jest.Mock;
  let toggleMcpServerEnabled: jest.Mock;

  beforeEach(() => {
    jest.resetModules();
    getMcpServerByNameAndScope = jest.fn();
    toggleMcpServerEnabled = jest.fn(() => true);
    jest.doMock('@/lib/db/mcp-servers', () => ({ getMcpServerByNameAndScope, toggleMcpServerEnabled }));
  });

  afterEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
  });

  test('record missing → false, no toggle; getXMcpEnabled null', async () => {
    getMcpServerByNameAndScope.mockReturnValue(undefined);
    const { setXMcpEnabled, getXMcpEnabled } = await import('../mcp-toggle');
    expect(setXMcpEnabled(true)).toBe(false);
    expect(getXMcpEnabled()).toBeNull();
    expect(toggleMcpServerEnabled).not.toHaveBeenCalled();
  });

  test('already enabled → idempotent true, no toggle', async () => {
    getMcpServerByNameAndScope.mockReturnValue({ id: 'x1', is_enabled: 1 });
    const { setXMcpEnabled } = await import('../mcp-toggle');
    expect(setXMcpEnabled(true)).toBe(true);
    expect(toggleMcpServerEnabled).not.toHaveBeenCalled();
  });

  test('disabled → toggles on', async () => {
    getMcpServerByNameAndScope.mockReturnValue({ id: 'x1', is_enabled: 0 });
    const { setXMcpEnabled } = await import('../mcp-toggle');
    expect(setXMcpEnabled(true)).toBe(true);
    expect(toggleMcpServerEnabled).toHaveBeenCalledWith('x1', true);
  });
});
