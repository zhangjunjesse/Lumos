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
  const rnd = (a, b) => a + Math.random() * (b - a);
  const EXT = 'pmpgnefoilpinnblccjddomajohmbpko';
  // EHunt 真实结构（bridge 自驱实测+用户截图坐实）：Vue 注入，类名前缀 eh-。
  // 每个 listing 的 tag 在 .eh-exe-tags-list > .eh-exe-tags-list-item，内有
  // .el-tooltip__trigger（tag 文字）+ .eh-exe-tags-list-item-value（仅 Views
  // total 如 "(16.1M)"）。**完整指标在 hover trigger 弹出的 .el-popper.is-dark
  // .el-tooltip 里**：Views total/monthly、Favorites、Sales total/monthly、
  // Competition。按内容签名 /Views:|Competition:/ 区分 EHunt 暗 tooltip 与
  // Etsy 自身 tooltip（class 空/配送评价文案）。
  const ehDetect = () => {
    try {
      return !!(document.querySelector('.eh-product-detail, .eh-exe-tags-list, .eh-panel-header')
        || document.querySelector('img[src*="' + EXT + '"]')
        || document.querySelector('[class^="eh-"], [class*=" eh-"]'));
    } catch (e) { return false; }
  };
  const tagText = (it) => {
    let t = '';
    try {
      const trg = it.querySelector('.el-tooltip__trigger');
      if (trg) t = (trg.innerText || trg.textContent || '').trim();
    } catch (e) {}
    if (!t) {
      try {
        const cl = it.cloneNode(true);
        cl.querySelectorAll('.eh-exe-tags-list-item-value, img').forEach((n) => n.remove());
        t = (cl.innerText || cl.textContent || '').trim();
      } catch (e) {}
    }
    return t;
  };
  const readEhTip = () => {
    let nodes = [];
    try {
      nodes = document.querySelectorAll('.el-popper.is-dark.el-tooltip, .el-popper.el-tooltip, [role="tooltip"]');
    } catch (e) {}
    for (const n of nodes) {
      const tx = (n.innerText || n.textContent || '').trim();
      if (tx && /Views:|Competition:|Favorites:|Sales:/i.test(tx) && tx.length < 600) return tx;
    }
    return '';
  };
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
  const domDeadline = Date.now() + 12000;
  while (Date.now() < domDeadline) {
    if (document.readyState === 'complete') break;
    await sleep(1000);
  }
  // 轮询等 EHunt 注入 tag 列表（≤55s，每轮 wake）。
  const ehDeadline = Date.now() + 30000;
  while (Date.now() < ehDeadline) {
    wake();
    try { if (document.querySelectorAll('.eh-exe-tags-list-item').length > 0) break; } catch (e) {}
    await sleep(1500);
  }
  let items = [];
  try { items = [...document.querySelectorAll('.eh-exe-tags-list-item')]; } catch (e) {}
  const itemCount = items.length;
  items = items.slice(0, 15); // 控时：Etsy listing 至多 ~13 tag；每项 hover ~1s，全程须 < CDP evaluate 超时
  const out = [];
  let tipSeen = 0;
  const clearTip = async () => {
    try {
      document.body.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 2, clientY: 2 }));
    } catch (e) {}
    for (let w = 0; w < 6; w += 1) {
      if (!readEhTip()) return;
      await sleep(180);
    }
  };
  for (const it of items) {
    const tag = tagText(it);
    if (!tag || tag.length < 2 || tag.length > 60) continue;
    let trg = null;
    try { trg = it.querySelector('.el-tooltip__trigger') || it; } catch (e) { trg = it; }
    // 关键准确性：hover 下一个前先让上一个 tooltip 消失，否则会把上一个
    // tag 的指标错记到当前 tag（实测前两个 tag 数据雷同即此）。
    await clearTip();
    try { trg.scrollIntoView({ block: 'center' }); } catch (e) {}
    const fire = (t) => { try { trg.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window })); } catch (e) {} };
    fire('mouseenter'); fire('mouseover'); fire('mousemove');
    let raw = '';
    for (let w = 0; w < 5; w += 1) {
      await sleep(220);
      raw = readEhTip();
      if (raw) break;
    }
    if (raw) tipSeen += 1;
    out.push({ tag: tag, raw: raw });
    fire('mouseout'); fire('mouseleave');
  }
  const ehunt = ehDetect() || itemCount > 0;
  const diag = ' [rs=' + document.readyState + ' vis=' + document.visibilityState
    + ' ehunt=' + (ehunt ? 1 : 0) + ' tagItems=' + itemCount + ' tips=' + tipSeen + ']';
  if (out.length > 0 && tipSeen > 0) {
    return JSON.stringify({ ehuntDetected: true, tags: out });
  }
  // 没抓到 tooltip：回传深扫快照（含真实 eh- 类名）供诊断。
  const deepRoots = () => {
    const o = []; const seen = new Set();
    const v = (r) => {
      if (!r || seen.has(r)) return; seen.add(r); o.push(r);
      let e = []; try { e = r.querySelectorAll('*'); } catch (x) {}
      for (const el of e) { if (el.shadowRoot) v(el.shadowRoot); }
      let f = []; try { f = r.querySelectorAll('iframe'); } catch (x) {}
      for (const z of f) { try { if (z.contentDocument) v(z.contentDocument); } catch (x) {} }
    };
    v(document); return o;
  };
  let probe = '';
  try {
    const roots = deepRoots();
    const ehEls = [];
    for (const r of roots) {
      let els = [];
      try { els = r.querySelectorAll('[class^="eh-"], [class*=" eh-"]'); } catch (x) {}
      for (const el of els) {
        const c = (el.className && el.className.toString) ? el.className.toString() : '';
        if (c) ehEls.push(c.slice(0, 60));
        if (ehEls.length >= 30) break;
      }
      if (ehEls.length >= 30) break;
    }
    probe = ('ROOTS=' + roots.length + ' ehDetect=' + (ehDetect() ? 1 : 0)
      + ' tagItems=' + itemCount + ' tipsSeen=' + tipSeen
      + '\\nEH_CLASSES:\\n' + [...new Set(ehEls)].join('\\n')).slice(0, 5000);
  } catch (e) { probe = 'probe 失败：' + (e && e.message ? e.message : String(e)); }
  return JSON.stringify({
    ehuntDetected: ehunt,
    reason: (ehunt
      ? (itemCount > 0
        ? 'EHunt tag 列表已注入但 hover 未弹出 .el-popper.is-dark.el-tooltip 指标浮窗（hover 触发/等待需调）'
        : 'EHunt 已检测到但未注入 .eh-exe-tags-list-item（页面非 listing / 结构变更）')
      : '未检测到 EHunt（未登录 / 非 EHunt 浏览器上下文 / 扩展未注入）') + diag,
    tags: [],
    domProbe: probe
  });
})()`;
