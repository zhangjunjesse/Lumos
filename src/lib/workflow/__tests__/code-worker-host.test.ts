// worker 宿主(#54)。脚本挪进 worker 线程后,ctx 里那些需要主线程能力的字段
// (browser.* / saveArtifact)变成了跨线程 RPC —— 这层桥是新代码,单独锁住。

import { runScriptInWorker } from '../code-worker-host';
import { CODE_SANDBOX_GLOBALS } from '../code-sandbox';
import type { CodeHandlerContext } from '../code-handler-types';

const noopConsole = { log() {}, warn() {}, error() {}, info() {}, debug() {} };

function buildCtx(overrides: Partial<CodeHandlerContext> = {}): CodeHandlerContext {
  return {
    params: {},
    stepId: 'step-1',
    workflowRunId: 'run-1',
    upstreamOutputs: {},
    runtimeContext: { workflowRunId: 'run-1', stepId: 'step-1', stepType: 'agent' },
    outputDir: '/tmp/lumos-test-output',
    browser: { connected: false } as unknown as CodeHandlerContext['browser'],
    saveArtifact: async () => '',
    exec: async () => ({ stdout: '', stderr: '' }),
    ...overrides,
  } as CodeHandlerContext;
}

function run(script: string, ctx: CodeHandlerContext, scriptConsole: unknown = noopConsole) {
  return runScriptInWorker(
    script,
    ctx,
    scriptConsole as Parameters<typeof runScriptInWorker>[2],
    CODE_SANDBOX_GLOBALS,
  );
}

describe('ctx 数据字段跨线程传递', () => {
  it('params / upstreamOutputs / outputDir / runtimeContext 都读得到', async () => {
    const ctx = buildCtx({
      params: { n: 7 },
      upstreamOutputs: { prev: { ok: true } },
      outputDir: '/tmp/out-dir',
      workingDirectory: '/tmp/work',
    });

    const out = await run(`return {
      n: ctx.params.n,
      prevOk: ctx.upstreamOutputs.prev.ok,
      outputDir: ctx.outputDir,
      runId: ctx.runtimeContext.workflowRunId,
      cwd: ctx.workingDirectory,
    };`, ctx);

    expect(out).toEqual({
      n: 7,
      prevOk: true,
      outputDir: '/tmp/out-dir',
      runId: 'run-1',
      cwd: '/tmp/work',
    });
  });
});

describe('browser RPC 代理', () => {
  it('脚本调 ctx.browser.* 时,主线程侧的真实现被调到并把结果传回', async () => {
    const navigate = jest.fn().mockResolvedValue(undefined);
    const snapshot = jest.fn().mockResolvedValue({ title: 'T', content: 'C', url: 'u' });
    const ctx = buildCtx({
      browser: { connected: true, navigate, snapshot } as unknown as CodeHandlerContext['browser'],
    });

    const out = await run(`
      await ctx.browser.navigate('https://example.com');
      const snap = await ctx.browser.snapshot();
      return { title: snap.title, connected: ctx.browser.connected };
    `, ctx);

    expect(navigate).toHaveBeenCalledWith('https://example.com');
    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(out).toEqual({ title: 'T', connected: true });
  });

  it('主线程侧抛错时,错误传回脚本且能被 try/catch 接住', async () => {
    const ctx = buildCtx({
      browser: {
        connected: true,
        navigate: jest.fn().mockRejectedValue(new Error('bridge down')),
      } as unknown as CodeHandlerContext['browser'],
    });

    const out = await run(`
      try {
        await ctx.browser.navigate('https://example.com');
        return 'no-throw';
      } catch (e) {
        return 'caught:' + e.message;
      }
    `, ctx);

    expect(out).toBe('caught:bridge down');
  });

  it('connected=false 如实传给脚本', async () => {
    const out = await run('return ctx.browser.connected;', buildCtx());
    expect(out).toBe(false);
  });
});

describe('saveArtifact RPC 代理', () => {
  it('Buffer 跨线程后仍是 Buffer(structuredClone 会降成 Uint8Array)', async () => {
    const saveArtifact = jest.fn().mockResolvedValue('/tmp/out/a.bin');
    const ctx = buildCtx({ saveArtifact });

    const out = await run(`
      return await ctx.saveArtifact(Buffer.from([1, 2, 3]), 'a.bin');
    `, ctx);

    expect(out).toBe('/tmp/out/a.bin');
    const [source, name] = saveArtifact.mock.calls[0];
    expect(Buffer.isBuffer(source)).toBe(true);
    expect([...(source as Buffer)]).toEqual([1, 2, 3]);
    expect(name).toBe('a.bin');
  });

  it('源文件路径形式照常透传', async () => {
    const saveArtifact = jest.fn().mockResolvedValue('/tmp/out/x.png');
    const ctx = buildCtx({ saveArtifact });

    await run(`return await ctx.saveArtifact('/tmp/src/x.png');`, ctx);

    expect(saveArtifact).toHaveBeenCalledWith('/tmp/src/x.png', undefined);
  });
});

describe('exec RPC 代理', () => {
  it('脚本里的 ctx.exec 转回主线程执行,结果传得回来', async () => {
    const exec = jest.fn().mockResolvedValue({ stdout: 'ran-ok', stderr: '' });
    const ctx = buildCtx({ exec });

    const out = await run(`
      const { stdout } = await ctx.exec('python', ['a.py', '--n', '1'], { timeoutMs: 5000 });
      return stdout;
    `, ctx);

    expect(out).toBe('ran-ok');
    expect(exec).toHaveBeenCalledWith('python', ['a.py', '--n', '1'], { timeoutMs: 5000 });
  });

  it('命令失败的错误传回脚本,能 try/catch', async () => {
    const ctx = buildCtx({
      exec: jest.fn().mockRejectedValue(new Error('Command failed\nboom reason')),
    });

    const out = await run(`
      try {
        await ctx.exec('python', ['a.py']);
        return 'no-throw';
      } catch (e) {
        return e.message;
      }
    `, ctx);

    expect(out).toContain('boom reason');
  });
});

describe('console 转发', () => {
  it('脚本 console 落到宿主 logger,分级和改造前一致', async () => {
    const logs: Array<[string, unknown[]]> = [];
    const scriptConsole = {
      log: (...a: unknown[]) => logs.push(['log', a]),
      warn: (...a: unknown[]) => logs.push(['warn', a]),
      error: (...a: unknown[]) => logs.push(['error', a]),
    };

    await run(`
      console.log('hello', { a: 1 });
      console.warn('careful');
      console.error('boom');
      return 1;
    `, buildCtx(), scriptConsole);

    expect(logs).toEqual([
      ['log', ['hello', { a: 1 }]],
      ['warn', ['careful']],
      ['error', ['boom']],
    ]);
  });

  it('不可克隆的参数降级成字符串,不炸掉整个执行', async () => {
    const logs: unknown[][] = [];
    const scriptConsole = { log: (...a: unknown[]) => logs.push(a) };

    const out = await run(`
      console.log(() => 1);
      return 'survived';
    `, buildCtx(), scriptConsole);

    expect(out).toBe('survived');
    expect(typeof logs[0][0]).toBe('string');
  });
});

// 改造前脚本和心跳共用主线程,同步阻塞时 AbortSignal 根本没人看 —— 取消是按不动的。
// 挪进 worker 后能 terminate,但生效程度分两种,下面两个用例把边界钉死:
//   - 纯 JS 忙等:V8 TerminateExecution 直接掐断,线程立刻回收。
//   - 卡在原生同步调用里(execFileSync 的 waitpid):terminate 要等系统调用自己返回,
//     已 spawn 的子进程也不会被连带杀掉。此时能保证的是「工作流不再等它」。
describe('取消', () => {
  it('纯 JS 忙等能被 abort 立刻掐断', async () => {
    const controller = new AbortController();
    const started = Date.now();
    const promise = run(
      'const t = Date.now(); while (Date.now() - t < 10000) {} return "should-not-reach";',
      buildCtx({ signal: controller.signal }),
    );

    setTimeout(() => controller.abort(), 200);

    await expect(promise).rejects.toThrow('aborted');
    expect(Date.now() - started).toBeLessThan(5_000);
  }, 20_000);

  it('卡在同步子进程里时,取消让工作流立即不再等它', async () => {
    const controller = new AbortController();
    const started = Date.now();
    const promise = run(`
      child_process.execFileSync(
        process.execPath,
        ['-e', 'const t = Date.now(); while (Date.now() - t < 800) {}'],
      );
      return 'should-not-reach';
    `, buildCtx({ signal: controller.signal }));

    setTimeout(() => controller.abort(), 150);

    await expect(promise).rejects.toThrow('aborted');
    // 子进程还要跑满 800ms(terminate 掐不断 waitpid),但调用方不该被拖着等。
    expect(Date.now() - started).toBeLessThan(600);

    // 等 worker 线程自然收尾 —— 这正是上面注释里那条边界的代价,别留给 jest 强杀。
    await new Promise((resolve) => setTimeout(resolve, 900));
  }, 20_000);

  it('signal 已经 aborted 时直接拒绝,不起 worker', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(run('return 1;', buildCtx({ signal: controller.signal })))
      .rejects.toThrow('aborted');
  });
});

describe('错误传播', () => {
  it('脚本抛的错保留 message 和 name', async () => {
    await expect(run('const e = new TypeError("bad thing"); throw e;', buildCtx()))
      .rejects.toThrow('bad thing');
  });

  it('语法错误也传回来,不静默变成成功', async () => {
    await expect(run('this is not valid js', buildCtx())).rejects.toThrow();
  });
});
