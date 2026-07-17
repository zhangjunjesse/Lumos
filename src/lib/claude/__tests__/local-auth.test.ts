import { isNativeCliBinary, resolveCliInvocation } from '@/lib/claude/local-auth';

// SDK 0.3.x 起,内置 Claude Runtime 是平台原生二进制(claude / claude.exe),
// 必须直接执行。历史 bug:local-auth 用 `node <binary>` 去跑,node 把二进制头
// (Mach-O / ELF / MZ)当 JS 解析 → `SyntaxError: Invalid or unexpected token`,
// 用户 Windows 登录彻底失败。这组测试锁死「原生二进制绝不被 node 包裹」这条不变量。

describe('isNativeCliBinary', () => {
  it('把原生二进制识别为原生(直接执行)', () => {
    expect(isNativeCliBinary('/opt/lumos/claude')).toBe(true);
    expect(isNativeCliBinary('C:\\Program Files\\Lumos\\claude.exe')).toBe(true);
    expect(isNativeCliBinary('claude')).toBe(true);
  });

  it('把 JS 入口识别为非原生(需要 node 启动)', () => {
    expect(isNativeCliBinary('/opt/lumos/cli.js')).toBe(false);
    expect(isNativeCliBinary('/opt/lumos/sdk.mjs')).toBe(false);
    expect(isNativeCliBinary('/opt/lumos/index.cjs')).toBe(false);
    expect(isNativeCliBinary('/opt/lumos/CLI.JS')).toBe(false);
  });
});

describe('resolveCliInvocation', () => {
  it('原生二进制:直接作为命令执行,绝不塞进 node 的参数里', () => {
    const cliPath = 'C:\\Program Files\\Lumos\\resources\\standalone\\node_modules\\@anthropic-ai\\claude-agent-sdk-win32-x64\\claude.exe';
    const cliArgs = ['/login'];

    const { command, args } = resolveCliInvocation(cliPath, cliArgs);

    // 命令就是二进制本身
    expect(command).toBe(cliPath);
    expect(args).toEqual(cliArgs);
    // 回归守卫:二进制绝不能出现在参数首位(那正是 `node <binary>` 的错误形态)
    expect(args[0]).not.toBe(cliPath);
  });

  it('原生二进制(darwin/unix):同样直跑', () => {
    const cliPath = '/opt/lumos/node_modules/@anthropic-ai/claude-agent-sdk-darwin-x64/claude';
    const { command, args } = resolveCliInvocation(cliPath, ['-p', 'ping']);
    expect(command).toBe(cliPath);
    expect(args).toEqual(['-p', 'ping']);
  });

  it('JS 入口:用 node 启动,脚本路径作为 node 的第一个参数', () => {
    const cliPath = '/opt/lumos/cli.js';
    const cliArgs = ['-p', 'ping'];

    const { command, args } = resolveCliInvocation(cliPath, cliArgs);

    // node 才是命令,脚本是参数
    expect(command).not.toBe(cliPath);
    expect(args[0]).toBe(cliPath);
    expect(args.slice(1)).toEqual(cliArgs);
  });
});
