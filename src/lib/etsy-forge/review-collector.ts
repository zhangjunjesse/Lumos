// Etsy 商品「全部评论」抓取（选择器经 AdsPower 真机探查得到，2026 Etsy DOM）。
//
// 详情页底部只展示前几条**预览**评论，必须点「View all reviews for this item」打开**弹框**
// （标题含 "Reviews for this item (N)"），在弹框里逐页翻才能拿到全部评论。
// 弹框内评论卡结构 ≠ 详情页预览卡：
//   卡 = [data-review-region="<交易id>"]（id 用于去重）
//   评分 = [role="img"][aria-label="Rating: X out of 5 stars"]
//   作者 = a[href*="/people/"]；日期 = 卡片文本里的 "Mon DD, YYYY"；正文 = .wt-text-body
//   翻页 = 弹框内 nav[aria-label="Pagination of reviews"] 的 Next 按钮（评论一页放得下时可能没有）
//
// 关键：详情页常以 domcontentloaded 就绪，但交互 JS 未必绑好——必须用 Playwright 可靠点击
// （等元素可交互 + 真实事件）打开弹框，再 waitForFunction 等弹框真出现，不能裸 evaluate click。
// 抓不到弹框/评论返回空（调用方如实显示「未抓到评论」，不伪造）。

export interface CollectedReview {
  author: string | null;
  rating: string | null;
  date: string | null;
  region: string | null;
  text: string;
}

const MAX_REVIEW_PAGES = 200;
const PER_REVIEW_TEXT_CAP = 2000;

interface ScrapeResult {
  reviews: Array<{ id: string | null; author: string | null; rating: string | null; date: string | null; text: string }>;
  pages: number;
}

// 页面内判断：评论弹框是否已就绪（带数字标题 "Reviews for this item (N)" + 其祖先含评论卡）。
// 不要求分页器——评论一页放得下的商品没有分页器。
function reviewsModalPresent(): boolean {
  const t = Array.from(document.querySelectorAll('h1,h2,h3')).find((h) =>
    /reviews for this item\s*\(\d+\)/i.test(h.textContent || ''),
  );
  if (!t) return false;
  let c: Element = t;
  for (let i = 0; i < 12 && c.parentElement; i++) {
    c = c.parentElement;
    if (c.querySelectorAll('[data-review-region]').length >= 1) return true;
  }
  return false;
}

export async function scrapeReviewsFromPage(
  page: import('playwright').Page,
  maxReviews: number,
  log: (m: string) => void,
): Promise<CollectedReview[]> {
  // 滚到评论区，触发懒加载 + 让 view-all 按钮进入可交互状态。
  await page
    .evaluate(() => {
      const h = Array.from(document.querySelectorAll('h1,h2,h3')).find((x) =>
        /reviews for this item/i.test(x.textContent || ''),
      );
      h?.scrollIntoView({ block: 'center' });
    })
    .catch(() => {});
  await page.waitForTimeout(1200);

  // 打开评论弹框（已开则跳过）。用 Playwright 可靠点击 + waitForFunction 等弹框真出现。
  let opened = await page.evaluate(reviewsModalPresent).catch(() => false);
  if (!opened) {
    try {
      const btn = page
        .locator('button, a, [role="button"]')
        .filter({ hasText: /view all reviews/i })
        .first();
      await btn.click({ timeout: 8000 });
    } catch (err) {
      log(`  点「View all reviews」失败：${err instanceof Error ? err.message.split('\n')[0] : String(err)}`);
    }
    opened = await page
      .waitForFunction(reviewsModalPresent, { timeout: 20_000 })
      .then(() => true)
      .catch(() => false);
  }
  if (!opened) {
    log('  未能打开评论弹框（页面可能未就绪或无评论）');
    return [];
  }

  const result = (await page
    .evaluate(
      async ({ max, textCap, maxPages }) => {
        const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
        const findModal = (): Element | null => {
          const t = Array.from(document.querySelectorAll('h1,h2,h3')).find((h) =>
            /reviews for this item\s*\(\d+\)/i.test(h.textContent || ''),
          );
          if (!t) return null;
          let c: Element = t;
          for (let i = 0; i < 12 && c.parentElement; i++) {
            c = c.parentElement;
            if (c.querySelectorAll('[data-review-region]').length >= 1) return c;
          }
          return null;
        };

        const collected: ScrapeResult['reviews'] = [];
        const seen = new Set<string>();
        let pages = 0;
        for (let pg = 1; pg <= maxPages; pg++) {
          const m = findModal();
          if (!m) break;
          pages = pg;
          const cards = Array.from(m.querySelectorAll('[data-review-region]')).map((rg) => {
            const text = (rg.querySelector('.wt-text-body')?.textContent || '').replace(/\s+/g, ' ').trim();
            const al = rg.querySelector('[role="img"][aria-label*="out of 5" i]')?.getAttribute('aria-label') || '';
            const rm = al.match(/([\d.]+)\s*out of/i);
            const author = (rg.querySelector('a[href*="/people/"]')?.textContent || '').trim();
            const dm = (rg.textContent || '').match(/[A-Z][a-z]{2,8} \d{1,2}, \d{4}/);
            return {
              id: rg.getAttribute('data-review-region'),
              author: author || null,
              rating: rm ? rm[1] : null,
              date: dm ? dm[0] : null,
              text: text.slice(0, textCap),
            };
          });
          const firstId = cards[0]?.id || null;
          let added = 0;
          for (const c of cards) {
            const key = c.id || `${c.author ?? ''}|${c.date ?? ''}|${c.text.slice(0, 40)}`;
            if (seen.has(key)) continue;
            seen.add(key);
            collected.push(c);
            added++;
            if (collected.length >= max) break;
          }
          if (collected.length >= max) break;
          if (added === 0 && pg > 1) break;

          // 翻页：点弹框内 Next，等首条评论 id 变化（无分页器=只有一页，break）
          const nav = m.querySelector('nav[aria-label*="agination of reviews" i]');
          if (!nav) break;
          const next = Array.from(nav.querySelectorAll('button,a')).find((el) =>
            /next/i.test(
              (el.getAttribute('aria-label') || '') +
                ' ' +
                (el.querySelector('.wt-screen-reader-only')?.textContent || '') +
                ' ' +
                (el.textContent || ''),
            ),
          ) as HTMLElement | null;
          if (
            !next ||
            (next as HTMLButtonElement).disabled ||
            next.getAttribute('aria-disabled') === 'true' ||
            /wt-is-disabled/.test(next.className || '')
          )
            break;
          next.scrollIntoView({ block: 'center' });
          next.click();
          let moved = false;
          for (let w = 0; w < 12; w++) {
            await sleep(700);
            const f = findModal()?.querySelector('[data-review-region]');
            if (f && f.getAttribute('data-review-region') !== firstId) {
              moved = true;
              break;
            }
          }
          if (!moved) break;
        }
        return { reviews: collected, pages };
      },
      { max: maxReviews, textCap: PER_REVIEW_TEXT_CAP, maxPages: MAX_REVIEW_PAGES },
    )
    .catch(() => null)) as ScrapeResult | null;

  if (!result) {
    log('  评论抓取异常（翻页/解析出错）');
    return [];
  }
  log(`  评论弹框：翻了 ${result.pages} 页，抓到 ${result.reviews.length} 条`);
  return result.reviews.map((c) => ({
    author: c.author,
    rating: c.rating,
    date: c.date,
    region: null,
    text: c.text,
  }));
}
