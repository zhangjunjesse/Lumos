// ctx.exec(#54)。提示词以前教 execFileSync,还专门写着「长任务用 spawnSync」——
// 而长任务恰恰必然超过 30 秒执行租约。这是取代它的官方入口,关键差别在于:
// 取消时命令进程是真的会被杀掉,不会变成孤儿继续写文件。

import { runExternalCommand } from '../code-exec';

const node = process.execPath;

describe('runExternalCommand', () => {
  it('拿得到 stdout', async () => {
    const { stdout } = await runExternalCommand(node, ['-e', 'process.stdout.write("hello")']);
    expect(stdout).toBe('hello');
  });

  it('stderr 单独给出,不和 stdout 混一起', async () => {
    const { stdout, stderr } = await runExternalCommand(node, [
      '-e', 'process.stdout.write("out"); process.stderr.write("warn")',
    ]);
    expect(stdout).toBe('out');
    expect(stderr).toBe('warn');
  });

  it('非 0 退出时抛错,并且错误里能看到 stderr(以前只能靠猜)', async () => {
    expect.assertions(2);
    try {
      await runExternalCommand(node, [
        '-e', 'process.stderr.write("boom reason"); process.exit(3)',
      ]);
    } catch (error) {
      const failure = error as Error & { stderr?: string };
      expect(failure.stderr).toBe('boom reason');
      expect(failure.message).toContain('boom reason');
    }
  });

  it('cwd 生效', async () => {
    const { stdout } = await runExternalCommand(
      node,
      ['-e', 'process.stdout.write(process.cwd())'],
      { cwd: process.cwd() },
    );
    expect(stdout).toBe(process.cwd());
  });

  it('env 注入进去,且不丢原有环境', async () => {
    const { stdout } = await runExternalCommand(
      node,
      ['-e', 'process.stdout.write(process.env.LUMOS_TEST_FLAG + "|" + Boolean(process.env.PATH))'],
      { env: { LUMOS_TEST_FLAG: 'on' } },
    );
    expect(stdout).toBe('on|true');
  });

  it('timeoutMs 到点掐断', async () => {
    const started = Date.now();
    await expect(runExternalCommand(
      node,
      ['-e', 'setTimeout(() => {}, 10000)'],
      { timeoutMs: 300 },
    )).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(5_000);
  }, 20_000);

  // 这条是 ctx.exec 存在的理由:execFileSync 被取消时杀不掉,进程会变孤儿接着跑。
  it('取消时命令进程真的被杀掉', async () => {
    const controller = new AbortController();
    const started = Date.now();

    const promise = runExternalCommand(
      node,
      ['-e', 'setTimeout(() => {}, 10000)'],
      {},
      controller.signal,
    );

    setTimeout(() => controller.abort(), 200);

    await expect(promise).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(5_000);
  }, 20_000);
});
