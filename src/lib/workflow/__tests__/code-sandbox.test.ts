// 内联脚本沙箱回归(#46)。
// 病史:生产 code 节点、run_workflow_code、编辑器「运行」按钮各自 new Function,
// 只有生产注入了 fs/path。AI 照文档写出能在生产跑通的脚本,一调试就 "fs is not defined"。
// 注入清单现在只有 code-sandbox 一处;这里锁死它。

import {
  CODE_SANDBOX_CAPABILITY_HINT,
  CODE_SANDBOX_GLOBALS,
  normalizeScriptResult,
  runInlineScript,
} from '../code-sandbox';
import type { CodeHandlerContext } from '../code-handler-types';

const ctx = { params: { n: 7 }, upstreamOutputs: {} } as unknown as CodeHandlerContext;
const noopConsole = { log() {}, warn() {}, error() {}, info() {}, debug() {} };

describe('CODE_SANDBOX_GLOBALS', () => {
  it('注入清单锁定(顺序即传参顺序)', () => {
    expect([...CODE_SANDBOX_GLOBALS]).toEqual([
      'ctx', 'fetch', 'console', 'fs', 'path', 'os', 'child_process',
    ]);
  });

  // 这条以前锁的是「hint 里要有 execFileSync」—— 而提示词教出来的正是 #54 那个 bug:
  // default-prompts 里甚至写着「长任务用 spawnSync」,长任务恰恰必然超过 30 秒租约。
  // 现在反过来锁:必须推 ctx.exec,且必须明说别用同步那几个。
  it('能力说明推 ctx.exec、劝阻同步 API,并点明没有 require', () => {
    expect(CODE_SANDBOX_CAPABILITY_HINT).toContain('ctx.exec');
    expect(CODE_SANDBOX_CAPABILITY_HINT).toContain('execFileSync');
    expect(CODE_SANDBOX_CAPABILITY_HINT).toMatch(/不要用[^。]*execFileSync/);
    expect(CODE_SANDBOX_CAPABILITY_HINT).toContain('require');
  });
});

describe('runInlineScript', () => {
  it('fs 和 path 真的可用(这就是 #46 调试环境炸掉的那两个)', async () => {
    const out = await runInlineScript(
      'return { hasFs: typeof fs.existsSync === "function", hasPath: typeof path.join === "function" };',
      ctx,
      noopConsole,
    ) as { hasFs: boolean; hasPath: boolean };
    expect(out.hasFs).toBe(true);
    expect(out.hasPath).toBe(true);
  });

  it('ctx 与 console 传得进去', async () => {
    const lines: unknown[][] = [];
    const out = await runInlineScript(
      'console.log("hi"); return ctx.params.n * 2;',
      ctx,
      { ...noopConsole, log: (...a: unknown[]) => lines.push(a) },
    );
    expect(out).toBe(14);
    expect(lines).toEqual([['hi']]);
  });

  it('脚本可以 await', async () => {
    const out = await runInlineScript('await Promise.resolve(); return "done";', ctx, noopConsole);
    expect(out).toBe('done');
  });

  it('child_process 可用,并且真能跑出本地命令的输出(#47 的核心诉求)', async () => {
    const out = await runInlineScript(
      'return child_process.execFileSync(process.execPath, ["-e", "process.stdout.write(\'ran-ok\')"], { encoding: "utf8" });',
      ctx,
      noopConsole,
    );
    expect(out).toBe('ran-ok');
  });

  it('os 可用', async () => {
    const out = await runInlineScript('return typeof os.tmpdir();', ctx, noopConsole);
    expect(out).toBe('string');
  });

  it('require 仍然没有(webpack 所致)——文档必须照实说,别让 AI 写 require', async () => {
    const out = await runInlineScript(
      'return typeof require === "undefined";',
      ctx,
      noopConsole,
    );
    expect(out).toBe(true);
  });

  it('命令执行失败时异常向外抛,不静默变成成功', async () => {
    await expect(runInlineScript(
      'return child_process.execFileSync(process.execPath, ["-e", "process.exit(3)"], { encoding: "utf8" });',
      ctx,
      noopConsole,
    )).rejects.toThrow();
  });

  it('脚本抛错向外传播,不被吞掉', async () => {
    await expect(runInlineScript('throw new Error("boom");', ctx, noopConsole))
      .rejects.toThrow('boom');
  });
});

// #54:脚本曾和 openworkflow 的续租心跳跑在同一条事件循环上。脚本一用
// execFileSync 冻住主线程,心跳(setInterval)停跳 → 30s 租约过期 → worker_id
// 被改写 → completeStepAttempt 的 worker_id 校验更新 0 行 → 步骤永远 running
// → 调度器无限重放。实测单个 run 重放 515 次,每次都真跑一遍 python + ImageMagick。
// 这里锁死隔离性:脚本再怎么同步阻塞,主线程的定时器都必须照常跑。
describe('事件循环隔离(#54)', () => {
  const blockingScript = (ms: number) => `
    child_process.execFileSync(
      process.execPath,
      ['-e', 'const t = Date.now(); while (Date.now() - t < ${ms}) {}'],
    );
    return 'blocked-${ms}';
  `;

  it('脚本里的同步阻塞不冻结主线程心跳', async () => {
    let beats = 0;
    const timer = setInterval(() => { beats += 1; }, 50);

    try {
      const out = await runInlineScript(blockingScript(600), ctx, noopConsole);
      expect(out).toBe('blocked-600');
    } finally {
      clearInterval(timer);
    }

    // 600ms 阻塞 / 50ms 心跳 ≈ 12 拍。留足余量,只要没被冻死就行。
    expect(beats).toBeGreaterThan(3);
  }, 20_000);

  it('并发脚本各自阻塞,互不拖累主线程', async () => {
    let beats = 0;
    const timer = setInterval(() => { beats += 1; }, 50);

    try {
      const outs = await Promise.all([
        runInlineScript(blockingScript(400), ctx, noopConsole),
        runInlineScript(blockingScript(400), ctx, noopConsole),
      ]);
      expect(outs).toEqual(['blocked-400', 'blocked-400']);
    } finally {
      clearInterval(timer);
    }

    expect(beats).toBeGreaterThan(3);
  }, 20_000);
});

describe('normalizeScriptResult', () => {
  it('按约定返回 StepResult 时原样透传', () => {
    const r = { success: false, output: null, error: 'x' };
    expect(normalizeScriptResult(r)).toBe(r);
  });

  it('没按约定返回时把返回值当 summary', () => {
    expect(normalizeScriptResult('hello')).toEqual({ success: true, output: { summary: 'hello' } });
    expect(normalizeScriptResult(undefined)).toEqual({ success: true, output: { summary: '' } });
    expect(normalizeScriptResult(42)).toEqual({ success: true, output: { summary: '42' } });
  });

  it('对象但没有 success 布尔字段的,也归一化', () => {
    expect(normalizeScriptResult({ foo: 1 })).toEqual({
      success: true,
      output: { summary: '[object Object]' },
    });
  });
});
