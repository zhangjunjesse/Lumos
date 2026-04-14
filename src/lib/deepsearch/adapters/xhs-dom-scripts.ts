/**
 * DOM-scrape payloads for Xiaohongshu. Executed inside the persistent
 * xhs tab by `siteEvaluate` after navigating to the target page. We scrape
 * rendered cards/content instead of hitting Edith — the signed-API path is
 * silently throttled (`success:true` with zero items) when called from
 * anywhere other than the xhs web bundle's own lifecycle.
 */

/** Wait for search result cards, then pull {url, title, author, likeText}. */
export const SEARCH_SCRAPE_SCRIPT = `(async () => {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const n = document.querySelectorAll('a[href*="/explore/"], a[href*="/search_result/"]').length;
    if (n >= 3) break;
    await wait(400);
  }

  const makeItem = (href, titleText, authorText, likeText, coverUrl) => {
    if (!href) return null;
    const m = href.match(/\\/(?:explore|search_result|discovery\\/item)\\/([0-9a-f]{16,})/i);
    if (!m) return null;
    const noteId = m[1];
    let xsec = '';
    try {
      const u = new URL(href, location.origin);
      xsec = u.searchParams.get('xsec_token') || '';
    } catch (_) { /* relative fallback ok */ }
    const qs = xsec ? ('?xsec_token=' + encodeURIComponent(xsec) + '&xsec_source=pc_search') : '';
    return {
      noteId,
      url: 'https://www.xiaohongshu.com/explore/' + noteId + qs,
      title: (titleText || '').replace(/\\s+/g, ' ').trim(),
      author: (authorText || '').replace(/\\s+/g, ' ').trim(),
      likeText: (likeText || '').trim(),
      coverUrl: coverUrl || '',
    };
  };

  const items = [];
  const seen = new Set();
  const push = (it) => {
    if (!it || seen.has(it.noteId)) return;
    seen.add(it.noteId);
    items.push(it);
  };

  const cards = Array.from(document.querySelectorAll('section.note-item, div.note-item, .feeds-page .note-item'));
  for (const card of cards) {
    const anchor = card.querySelector('a[href*="/explore/"], a[href*="/search_result/"]');
    if (!anchor) continue;
    const titleEl = card.querySelector('a.title, .title span, .title, .footer .title');
    const authorEl = card.querySelector('.author .name, .author-wrapper .name, .user-name, .author');
    const likeEl = card.querySelector('.like-wrapper .count, .interact-container .count, .count');
    const imgEl = card.querySelector('img');
    push(makeItem(
      anchor.getAttribute('href') || '',
      titleEl ? titleEl.textContent : '',
      authorEl ? authorEl.textContent : '',
      likeEl ? likeEl.textContent : '',
      imgEl ? (imgEl.getAttribute('src') || imgEl.getAttribute('data-src') || '') : '',
    ));
  }

  if (items.length === 0) {
    const anchors = document.querySelectorAll('a[href*="/explore/"], a[href*="/search_result/"]');
    anchors.forEach((a) => {
      const title = (a.getAttribute('title') || a.textContent || '').trim();
      push(makeItem(a.getAttribute('href') || '', title, '', '', ''));
    });
  }

  return { items, count: items.length, href: location.href, bodyLen: document.body ? document.body.innerText.length : 0 };
})()`;

/** Wait for note content or a block overlay, then extract. */
export const NOTE_SCRAPE_SCRIPT = `(async () => {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const deadline = Date.now() + 10000;
  const isBlocked = () => {
    const t = document.body ? document.body.innerText : '';
    return t.indexOf('当前笔记暂时无法浏览') >= 0 || t.indexOf('笔记不存在') >= 0;
  };
  while (Date.now() < deadline) {
    if (isBlocked()) break;
    if (document.querySelector('#detail-title, .note-content .title, #detail-desc, .note-scroller .title')) break;
    await wait(400);
  }

  if (isBlocked()) {
    return { blocked: true, href: location.href };
  }

  const pickText = (sel) => {
    const el = document.querySelector(sel);
    return el ? (el.textContent || '').replace(/\\s+/g, ' ').trim() : '';
  };

  const titleEl = document.querySelector('#detail-title, .note-content .title, .title');
  const descEl = document.querySelector('#detail-desc, .note-content .desc, .note-text, .desc');
  const authorEl = document.querySelector('.author-wrapper .name, .user-wrapper .name, .user-name, .username');
  const interact = document.querySelector('.interact-container, .bottom-container, .engage-bar');
  const likeEl = interact ? interact.querySelector('.like-wrapper .count, .like-active .count, .like .count') : null;
  const collectEl = interact ? interact.querySelector('.collect-wrapper .count, .collect .count') : null;
  const commentEl = interact ? interact.querySelector('.chat-wrapper .count, .comment .count') : null;
  const tagEls = document.querySelectorAll('#detail-desc a[href*="/search_result"], .note-text a[href*="/search_result"], .tag');
  const tags = Array.from(tagEls)
    .map((t) => (t.textContent || '').trim().replace(/^#/, ''))
    .filter(Boolean);
  const imgEls = document.querySelectorAll('.note-content img, .swiper-slide img, .media-container img');
  const images = Array.from(imgEls)
    .map((i) => i.getAttribute('src') || i.getAttribute('data-src') || '')
    .filter((s) => s && s.indexOf('http') === 0)
    .slice(0, 12);

  return {
    blocked: false,
    href: location.href,
    title: titleEl ? (titleEl.textContent || '').trim() : '',
    desc: descEl ? (descEl.textContent || '').trim() : '',
    author: authorEl ? (authorEl.textContent || '').trim() : '',
    likedText: likeEl ? (likeEl.textContent || '').trim() : '',
    collectedText: collectEl ? (collectEl.textContent || '').trim() : '',
    commentText: commentEl ? (commentEl.textContent || '').trim() : '',
    tags,
    images,
    ipLocation: pickText('.ip-location, .date .location'),
  };
})()`;

/** Detect login state via the web_session cookie that xhs sets when logged in. */
export const LOGIN_PROBE_SCRIPT = `(() => {
  const cookie = document.cookie || '';
  const loggedIn = /(?:^|;\\s*)web_session=/.test(cookie) && !/web_session=\\s*;/.test(cookie);
  return { loggedIn, href: location.href };
})()`;
