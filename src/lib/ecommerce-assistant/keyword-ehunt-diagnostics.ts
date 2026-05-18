/**
 * 类目&关键词调研 —— EHunt hover 诊断（日志 + 瞬态导航错误分类）。
 *
 * 从 keyword-ehunt-hover 抽出：失败时不再只有一句干 reason，而是每次尝试
 * 的 URL/阶段/错误都打到服务端日志（终端可见），并把精简轨迹回写进
 * reason 让报告里也能定位——以前无日志只能跨多轮盲猜，这里终结它。
 */

const LOG_PREFIX = '[keyword-ehunt-hover]';

/**
 * "页面执行中跳转/重定向/重载把脚本执行环境销毁" 这类**瞬态**错误：
 * 页面早期那次重定向（Etsy 地区/合规/canonical）后会稳定，退避重试即可
 * 落到稳定 context。与"未登录/选择器不对"这类**确定性**失败区分开。
 */
export function isTransientNavError(msg: string): boolean {
  return /execution context was destroyed|cannot find context|context with specified id|target closed|session closed|frame (?:was )?detached|page has been closed|navigation|net::err|detached frame/i.test(
    msg,
  );
}

export interface HoverLog {
  /** 记一条轨迹（同时 console.log，服务端日志可见）。 */
  step: (line: string) => void;
  /** 汇总轨迹为单行，拼进失败 reason 让报告里也能定位。 */
  trace: () => string;
}

/** 每个 listing 一个 logger；url 截短避免日志/报告过长。 */
export function createHoverLog(url: string): HoverLog {
  const short = url.length > 80 ? url.slice(0, 80) + '…' : url;
  const lines: string[] = [];
  return {
    step(line: string) {
      lines.push(line);
      console.log(`${LOG_PREFIX} ${short} :: ${line}`);
    },
    trace() {
      return lines.length ? ` 〔轨迹：${lines.join(' → ')}〕` : '';
    },
  };
}
