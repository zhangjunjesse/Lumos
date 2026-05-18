/**
 * 页内脚本（字符串表达式，在目标页求值，返回 JSON）。原则（对齐风险文档）：
 * 文本模糊匹配定位、不硬编码脆弱选择器；hover 后等浮窗渲染；抓 raw 文本由
 * 服务端正则解析；定位不到不抛、返回 reason。
 *
 * 从 keyword-ehunt-hover 抽出（纯字符串、零类型依赖）：主文件守 300 行硬规。
 */

/**
 * 预稳探针：短小（≤25s）、可单独重试。等页面跳转/重定向落定——
 * readyState=complete 且 location.href 连续 3s 不变——再放重脚本上场。
 * Etsy 早期重定向会落在这个廉价探针期间（被销毁就重试，重定向后秒回），
 * 而非 75s 重脚本期间，从根上规避 "Execution context was destroyed"。
 */
export const SETTLE_SCRIPT = `(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const deadline = Date.now() + 25000;
  let lastHref = location.href;
  let stableSince = Date.now();
  while (Date.now() < deadline) {
    const href = location.href;
    if (href !== lastHref) { lastHref = href; stableSince = Date.now(); }
    if (document.readyState === 'complete' && Date.now() - stableSince >= 3000) {
      return JSON.stringify({ ready: true, href: href });
    }
    await sleep(800);
  }
  return JSON.stringify({ ready: false, href: location.href });
})()`;

export const HOVER_SCRIPT = `(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const rnd = (a,b) => a + Math.random()*(b-a);
  const sig = /estimated\\s*search|search\\s*volume|competition|搜索量|竞争度|monthly\\s*search/i;
  const TAG_SEL = 'a[href*="/search?q="], a[href*="etsy.com/c/"], a[href*="/market/"], [class*="tag" i] a, [class*="tag" i] span, [class*="chip" i]';
  const hasEhunt = () => !!document.querySelector('[class*="ehunt" i],[id*="ehunt" i],[data-ehunt]')
    || /ehunt/i.test(document.body ? document.body.innerText.slice(0, 5000) : '');
  const tagCount = () => document.querySelectorAll(TAG_SEL).length;
  // 后台自动化页 visibilityState 恒为 'hidden'，EHunt 这类扩展常把数据抓取
  // 门控在「页面可见/获焦/滚动」上 → 后台页无论等多久都不注入数据（这才
  // 是时序修好后"每次还是同样问题"的更深层因）。不前台化、不碰全局浏览器
  // （守 CLAUDE.md 后台规则与 feedback_no_global_browser_changes）；只在页内
  // 主动派发可见/获焦事件并滚动，触发扩展的 visibilitychange /
  // IntersectionObserver / scroll 钩子去拉数据。
  const wake = () => {
    try {
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('pageshow'));
      document.dispatchEvent(new Event('visibilitychange'));
      const h = document.body ? document.body.scrollHeight : 0;
      window.scrollTo(0, Math.floor(h * 0.5)); window.dispatchEvent(new Event('scroll'));
      window.scrollTo(0, h); window.dispatchEvent(new Event('scroll'));
      window.scrollTo(0, 0);
    } catch (e) {}
  };
  wake();
  // 0) 就绪等待，分两段。a) 等 DOM complete + tag 元素出现，最长 ~20s；
  //    b) 再持续轮询直到 hasEhunt()，最长 ~55s（超过姊妹 ehunt 模块 45s
  //    经验值），每轮重新 wake()，绝不因 DOM 已 complete 提前放弃注入。
  const domDeadline = Date.now() + 20000;
  while (Date.now() < domDeadline) {
    if (document.readyState === 'complete' && tagCount() > 0) break;
    await sleep(1000);
  }
  const ehuntDeadline = Date.now() + 55000;
  while (Date.now() < ehuntDeadline) {
    wake();
    if (hasEhunt()) break;
    await sleep(1500);
  }
  const ehuntMark = hasEhunt();
  // 诊断信号回传：失败时不再笼统三选一，让首次真跑就能定位（对齐模块
  // "如实标原因不伪造" + "推测没中就停下要数据"，停止盲目循环猜测）。
  const diag = ' [rs=' + document.readyState + ' vis=' + document.visibilityState
    + ' tags=' + tagCount() + ' ehunt=' + (ehuntMark ? 1 : 0) + ']';
  // 2) 收集 tag 元素：listing 的 tag 通常是短文本链接（Etsy 站内搜索/类目），
  //    或 EHunt 注入的 chip。文本 1-5 词、长度合理，去重。
  const cands = [];
  const seen = new Set();
  const push = (el) => {
    const t = (el.innerText || el.textContent || '').trim();
    if (!t || t.length < 2 || t.length > 40) return;
    if (t.split(/\\s+/).length > 5) return;
    const key = t.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    cands.push({ el, tag: t });
  };
  document.querySelectorAll(TAG_SEL).forEach(push);
  const tags = cands.slice(0, 15);
  if (tags.length === 0) {
    return JSON.stringify({ ehuntDetected: ehuntMark, reason: (ehuntMark
      ? '页面已加载且检测到 EHunt，但未找到可 hover 的 tag 元素（listing 页结构或选择器需按真实 DOM 调整）'
      : '等待页面加载与 EHunt 注入（最长约 75s，已主动派发可见/滚动事件唤醒后台页）后仍无 tag 元素且未检测到 EHunt（页面未就绪 / EHunt 未登录 / 非 EHunt 浏览器上下文 / 后台页扩展未激活）') + diag, tags: [] });
  }
  // 3) 逐 tag hover，抓最可能的浮窗文本（新出现 / role=tooltip / tippy / 含信号词）。
  const out = [];
  let sawTooltip = false;
  for (const { el, tag } of tags) {
    try { el.scrollIntoView({ block: 'center' }); } catch (e) {}
    const fire = (type) => el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    fire('mouseover'); fire('mouseenter'); fire('mousemove');
    await sleep(rnd(450, 650));
    let raw = '';
    const tip = document.querySelector('[role="tooltip"], .tippy-box, [class*="tooltip" i], [class*="popover" i], [class*="ehunt" i] [class*="pop" i]');
    if (tip && sig.test(tip.innerText || '')) raw = (tip.innerText || '').trim();
    if (!raw) {
      // fallback：扫描可见元素里含信号词且文本不长的，取最短的那个
      let best = '';
      document.querySelectorAll('div,section,span,table,ul').forEach((n) => {
        const tx = (n.innerText || '').trim();
        if (tx && tx.length < 400 && sig.test(tx) && (best === '' || tx.length < best.length)) best = tx;
      });
      raw = best;
    }
    if (raw) sawTooltip = true;
    out.push({ tag, raw });
    el.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
    await sleep(rnd(800, 1500));
  }
  return JSON.stringify({ ehuntDetected: ehuntMark || sawTooltip, reason: (ehuntMark || sawTooltip) ? undefined : ('hover 未出现含搜索量/竞争度的浮窗，EHunt 可能未登录、未注入，或后台页扩展未激活' + diag + ' tooltip=0'), tags: out });
})()`;
