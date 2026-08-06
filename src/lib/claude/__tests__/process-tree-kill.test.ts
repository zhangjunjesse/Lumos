// #59:步骤取消后 gallery-dl 等孙子进程继续跑(实测 cancel 两分钟后还在写文件)。
// SDK 对 CLI 只做 child.kill(),不碰子孙。这里验证"杀整棵树"的行为按平台分派且不抛错。

const spawnMock = jest.fn();
jest.mock('child_process', () => ({ spawn: (...a: unknown[]) => spawnMock(...a) }));

import { killProcessTree, createTrackedSpawn } from '../process-tree-kill';

const realPlatform = process.platform;
function setPlatform(p: string) {
  Object.defineProperty(process, 'platform', { value: p, configurable: true });
}
afterEach(() => {
  setPlatform(realPlatform);
  spawnMock.mockReset();
  jest.resetModules();
});

describe('killProcessTree', () => {
  it('无效 pid 直接返回 false,不做任何事', () => {
    expect(killProcessTree(undefined)).toBe(false);
    expect(killProcessTree(0)).toBe(false);
    expect(killProcessTree(-1)).toBe(false);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('POSIX:优先杀进程组(负 pid),这才能带走子孙', () => {
    const killSpy = jest.spyOn(process, 'kill').mockImplementation(() => true);
    expect(killProcessTree(4242)).toBe(true);
    expect(killSpy).toHaveBeenCalledWith(-4242, 'SIGKILL');
    killSpy.mockRestore();
  });

  it('POSIX:没建成进程组时退回单进程,不抛错', () => {
    const killSpy = jest.spyOn(process, 'kill').mockImplementation((pid) => {
      if (typeof pid === 'number' && pid < 0) throw new Error('ESRCH');
      return true;
    });
    expect(killProcessTree(4242)).toBe(true);
    expect(killSpy).toHaveBeenLastCalledWith(4242, 'SIGKILL');
    killSpy.mockRestore();
  });

  it('进程已不存在 → 返回 false 而不是抛错(取消收尾不该再炸一次)', () => {
    const killSpy = jest.spyOn(process, 'kill').mockImplementation(() => { throw new Error('ESRCH'); });
    expect(killProcessTree(4242)).toBe(false);
    killSpy.mockRestore();
  });
});

describe('createTrackedSpawn', () => {
  it('把 spawn 出来的进程交给回调(取消时才有 pid 可杀)', () => {
    const fake = { pid: 999 };
    spawnMock.mockReturnValue(fake);
    let captured: unknown;
    const fn = createTrackedSpawn((c) => { captured = c; });
    const ret = fn({ command: 'claude', args: [], env: {}, signal: new AbortController().signal });
    expect(captured).toBe(fake);
    expect(ret).toBe(fake);
  });

  it('非 Windows 平台 detached:true —— 建独立进程组,整组回收的前提', () => {
    // 本测试在 macOS/Linux 上跑(CI 与开发机均如此);Windows 分支由 killProcessTree
    // 的 taskkill 路径覆盖,那条不依赖 detached。
    if (realPlatform === 'win32') return;
    spawnMock.mockReturnValue({ pid: 1 });
    createTrackedSpawn(() => {})({ command: 'c', args: [], env: {}, signal: new AbortController().signal });
    expect(spawnMock.mock.calls[0][2]).toMatchObject({ detached: true });
  });

  it('三个 stdio 都是 pipe(SDK 的 SpawnedProcess 要求非空)', () => {
    spawnMock.mockReturnValue({ pid: 1 });
    createTrackedSpawn(() => {})({ command: 'c', args: [], env: {}, signal: new AbortController().signal });
    expect(spawnMock.mock.calls[0][2]).toMatchObject({ stdio: ['pipe', 'pipe', 'pipe'] });
  });
});
