/**
 * 10 个平台的纯数据配置 (URL + 选择器 + 抠 ID 正则)。
 *
 * 不含脚本逻辑 —— DSL 构造时由 workflow.dsl.ts 把 selectors 编译成
 * 浏览器内可执行的 inline script 字符串。
 *
 * 选择器需上线前用真实 DOM 校准。
 */

import type { PlatformConfig } from './types';

export const FANQIE: PlatformConfig = {
  platform: 'fanqie',
  humanName: '番茄小说',
  baseUrl: 'https://fanqienovel.com',
  rank: {
    url: 'https://fanqienovel.com/page/rank',
    bookIdRegex: '\\/page\\/(\\d+)',
    selectors: {
      listItem: '.rank-list .book-item, .rank-page .book-card',
      title: '.book-title, .title',
      author: '.book-author, .author',
      category: '.book-category, .category',
      intro: '.book-intro, .desc',
      link: 'a[href*="/page/"]',
      rankBadge: '.rank-num, .rank-badge',
    },
  },
  book: {
    urlTemplate: 'https://fanqienovel.com/page/${id}',
    freeStrategy: 'badge-only',
    selectors: {
      title: '.book-title, h1',
      author: '.author-name, .author',
      intro: '.book-summary, .book-desc',
      tag: '.book-tag, .tag-item',
      chapterListItem: '.chapter-list .chapter-item, .catalog .item',
      chapterFreeBadge: '.free-tag, .badge-free',
      chapterLink: 'a',
    },
    reader: {
      title: '.chapter-title, .reader-title, h1',
      content: '.chapter-content, .reader-content article',
    },
  },
  reviews: {
    pageUrlExpr: '`${url}#comment`',
    selectors: {
      listItem: '.comment-list .comment-item, .review-item',
      text: '.comment-text, .review-content',
      likes: '.like-count, .likes',
    },
  },
};

export const QIDIAN: PlatformConfig = {
  platform: 'qidian',
  humanName: '起点中文网',
  baseUrl: 'https://www.qidian.com',
  rank: {
    url: 'https://www.qidian.com/rank/yuepiao/',
    bookIdRegex: '\\/(?:book|info)\\/(\\d+)',
    selectors: {
      listItem: '#rank-view-list li, .rank-table-list li',
      title: '.book-mid-info h2 a, .book-name',
      author: '.author a, .book-author',
      category: '.author span:nth-child(2), .book-category',
      intro: '.intro',
      link: '.book-mid-info h2 a, .book-name',
      rankBadge: '.rank-num, .num',
    },
  },
  book: {
    urlTemplate: 'https://book.qidian.com/info/${id}',
    freeStrategy: 'first-n',
    selectors: {
      title: '.book-info h1 em, .book-info-detail h1',
      author: '.book-info h1 a, .writer',
      intro: '.book-intro p, #book-intro-detail',
      tag: '.tag a, .tag-wrap a',
      chapterListItem: '.volume li, .catalog-list li',
      chapterFreeBadge: '.free, .icon-free',
      chapterLink: 'a',
    },
    reader: {
      title: '.j_chapterName, .text-head h1',
      content: '.read-content, .text-body',
    },
  },
  reviews: {
    pageUrlExpr: '`${url}#book-comment`',
    selectors: {
      listItem: '.comment-list .comment-item, .review-list-item',
      text: '.comment-text, .review-content',
      likes: '.like-num, .praise',
    },
  },
};

export const JJWXC: PlatformConfig = {
  platform: 'jjwxc',
  humanName: '晋江文学城',
  baseUrl: 'https://www.jjwxc.net',
  rank: {
    url: 'https://www.jjwxc.net/topten.php?orderstr=4',
    bookIdRegex: 'novelid=(\\d+)',
    selectors: {
      listItem: 'table.cytable tr',
      title: 'a[href*="onebook.php"]',
      author: 'td:nth-child(2) a',
      category: 'td:nth-child(4)',
      intro: 'td:nth-child(7), .intro',
      link: 'a[href*="onebook.php"]',
      rankBadge: 'td:nth-child(1)',
    },
  },
  book: {
    urlTemplate: 'https://www.jjwxc.net/onebook.php?novelid=${id}',
    freeStrategy: 'first-n',
    selectors: {
      title: '#oneboolt h1 span[itemprop="articleSection"], .pic_title',
      author: '#oneboolt span[itemprop="author"], .author',
      intro: '#novelintro, [itemprop="description"]',
      tag: '.smallreaderbtn a, .keywordsTd a',
      chapterListItem: '#oneboolt table tr[itemprop="chapter"], .cytable tr',
      chapterLink: 'a',
    },
    reader: {
      title: 'h2, .noveltitle',
      content: '.noveltext, [itemprop="acticleBody"]',
    },
  },
  reviews: {
    pageUrlExpr: 'url.replace("onebook.php", "comment.php")',
    selectors: {
      listItem: '.comment_list .comment_one, .commentbox',
      text: '.commentcontent, .text',
      likes: '.zandiv_count, .zan',
    },
  },
};

export const QIMAO: PlatformConfig = {
  platform: 'qimao',
  humanName: '七猫小说',
  baseUrl: 'https://www.qimao.com',
  rank: {
    url: 'https://www.qimao.com/rank/',
    bookIdRegex: '\\/book\\/(\\d+)',
    selectors: {
      listItem: '.rank-list li, .book-list .item',
      title: '.book-name, h3',
      author: '.book-author, .author',
      category: '.book-category, .cate',
      intro: '.book-intro, .desc',
      link: 'a[href*="/book/"]',
      rankBadge: '.rank-num',
    },
  },
  book: {
    urlTemplate: 'https://www.qimao.com/book/${id}/',
    freeStrategy: 'first-n',
    selectors: {
      title: '.book-name, .info-name h1',
      author: '.author-name, .info-author',
      intro: '.book-intro p, .desc',
      tag: '.tags a, .tag-item',
      chapterListItem: '.chapter-list li, .directory-list li',
      chapterLink: 'a',
    },
    reader: {
      title: '.chapter-title, h1',
      content: '.chapter-content, .text-content',
    },
  },
  reviews: {
    pageUrlExpr: '`${url}#comment`',
    selectors: {
      listItem: '.comment-list .comment-item',
      text: '.comment-content',
      likes: '.like-count',
    },
  },
};

export const FALOO: PlatformConfig = {
  platform: 'faloo',
  humanName: '飞卢小说',
  baseUrl: 'https://b.faloo.com',
  rank: {
    url: 'https://b.faloo.com/l/0/1.html',
    bookIdRegex: '\\/book\\/(\\d+)',
    selectors: {
      listItem: '.TwoBox02 li, .NewsListBox li',
      title: '.TwoBox02_03 a, .TwoBox02_05 a',
      author: '.TwoBox02_06, .author',
      category: '.TwoBox02_04, .cate',
      intro: '.TwoBox02_05, .intro',
      link: 'a[href*="/book/"]',
    },
  },
  book: {
    urlTemplate: 'https://b.faloo.com/${id}.html',
    freeStrategy: 'first-n',
    selectors: {
      title: '#novelName, h1',
      author: '.fpw a, .author',
      intro: '.T-L-T-C-Box1, .intro',
      tag: '.tag a',
      chapterListItem: '.DivTd, .chapterList a',
      chapterLink: 'a',
    },
    reader: {
      title: 'h1, .c_l_title',
      content: '.noveContent, #txt',
    },
  },
  reviews: {
    pageUrlExpr: '`${url}#comment`',
    selectors: {
      listItem: '.PinglunDiv, .review-item',
      text: '.PLcontent, .content',
      likes: '.up, .like',
    },
  },
};

export const ZONGHENG: PlatformConfig = {
  platform: 'zongheng',
  humanName: '纵横中文网',
  baseUrl: 'https://www.zongheng.com',
  rank: {
    url: 'https://www.zongheng.com/rank/details.html?rt=1&d=1&p=1',
    bookIdRegex: '\\/book\\/(\\d+)',
    selectors: {
      listItem: '.rank_d_list .bookbox',
      title: '.bookname a, .fl a',
      author: '.bookilnk a:first-child, .author',
      category: '.bookilnk a:last-child, .cate',
      intro: '.bookintro, .intro',
      link: '.bookname a',
      rankBadge: '.num, .rank-num',
    },
  },
  book: {
    urlTemplate: 'https://book.zongheng.com/book/${id}.html',
    freeStrategy: 'first-n',
    selectors: {
      title: '.book-name, h1.book-name',
      author: '.au-name a, .author',
      intro: '.book-dec p, .intro',
      tag: '.book-label a, .tags a',
      chapterListItem: '.chapter-list li, .volume li',
      chapterFreeBadge: '.free, .badge-free',
      chapterLink: 'a',
    },
    reader: {
      title: '.title_txtbox, h1',
      content: '.content, #readerFs',
    },
  },
  reviews: {
    pageUrlExpr: 'url.replace("book.zongheng.com", "bbs.zongheng.com")',
    selectors: {
      listItem: '.comment-list .comment-item',
      text: '.comment-content, .text',
      likes: '.like-count, .praise',
    },
  },
};

export const SEVENTEEN_K: PlatformConfig = {
  platform: '17k',
  humanName: '17K 小说网',
  baseUrl: 'https://www.17k.com',
  rank: {
    url: 'https://www.17k.com/top/refuse/00000000_0_0_0_3_0_1_0_1.html',
    bookIdRegex: '\\/book\\/(\\d+)',
    selectors: {
      listItem: '.RBList .clearfix, .top_list_box .item',
      title: '.tit a, .name a',
      author: '.aut, .author',
      category: '.tag, .cate',
      intro: '.intro',
      link: '.tit a, .name a',
      rankBadge: '.num, .rank-num',
    },
  },
  book: {
    urlTemplate: 'https://www.17k.com/book/${id}.html',
    freeStrategy: 'first-n',
    selectors: {
      title: '.Info h1, .book-name',
      author: '.Info .author a, .author',
      intro: '.Info .intro, .book-intro',
      tag: '.tag a, .tags a',
      chapterListItem: '.Volume .VolumeList li, .chapter-list li',
      chapterLink: 'a',
    },
    reader: {
      title: '.readAreaBox h1, .chapter-title',
      content: '.readAreaBox .p, .chapter-content',
    },
  },
  reviews: {
    pageUrlExpr: 'url.replace(".html", "/comment.html")',
    selectors: {
      listItem: '.comment-list .comment-item',
      text: '.comment-content, .text',
      likes: '.like, .praise',
    },
  },
};

export const CIWEIMAO: PlatformConfig = {
  platform: 'ciweimao',
  humanName: '刺猬猫',
  baseUrl: 'https://www.ciweimao.com',
  rank: {
    url: 'https://www.ciweimao.com/category-book-list/0/index/0/0/30/1/1/0',
    bookIdRegex: '\\/book\\/(\\d+)',
    selectors: {
      listItem: '.book-list .book-item, .rank-book-list .item',
      title: '.book-name, h3',
      author: '.author, .book-author',
      category: '.cate, .category',
      intro: '.intro, .book-desc',
      link: 'a[href*="/book/"]',
    },
  },
  book: {
    urlTemplate: 'https://www.ciweimao.com/book/${id}',
    freeStrategy: 'first-n',
    selectors: {
      title: '.book-name, h1',
      author: '.author-name, .author a',
      intro: '.book-intro, .description',
      tag: '.tag a, .tags a',
      chapterListItem: '.book-chapter-list li, .chapter-list li',
      chapterLink: 'a',
    },
    reader: {
      title: '.chapter-title, h2',
      content: '.chapter, .read-text',
    },
  },
  reviews: {
    pageUrlExpr: '`${url}#comment`',
    selectors: {
      listItem: '.comment-list .comment-item',
      text: '.comment-content',
      likes: '.like-count',
    },
  },
};

export const SFACG: PlatformConfig = {
  platform: 'sfacg',
  humanName: 'SF 轻小说',
  baseUrl: 'https://book.sfacg.com',
  rank: {
    url: 'https://book.sfacg.com/List/Default.aspx?tid=-1&PageIndex=1',
    bookIdRegex: '\\/Novel\\/(\\d+)',
    selectors: {
      listItem: '.Comic_Pic_List li, .book-list li',
      title: '.Comic_Pic_List_Right h3 a, .book-name a',
      author: '.Comic_Pic_List_Right p:nth-child(2), .author',
      category: '.Comic_Pic_List_Right p:nth-child(3), .cate',
      intro: '.Comic_Pic_List_Right .Description, .intro',
      link: 'a[href*="/Novel/"]',
    },
  },
  book: {
    urlTemplate: 'https://book.sfacg.com/Novel/${id}/',
    freeStrategy: 'first-n',
    selectors: {
      title: '.title h1, .book-info h1',
      author: '.author-name a, .author',
      intro: '.book-info .intro, .Description',
      tag: '.tags a, .label a',
      chapterListItem: '.story-catalog .catalog-list li, .chapter-list li',
      chapterLink: 'a',
    },
    reader: {
      title: '.article-title, h1',
      content: '.article-content, #ChapterBody',
    },
  },
  reviews: {
    pageUrlExpr: 'url.replace("book.sfacg.com", "comment.sfacg.com")',
    selectors: {
      listItem: '.comment-list .comment-item',
      text: '.comment-content',
      likes: '.zan-count, .like',
    },
  },
};

export const HONGXIU: PlatformConfig = {
  platform: 'hongxiu',
  humanName: '红袖添香',
  baseUrl: 'https://www.hongxiu.com',
  rank: {
    url: 'https://www.hongxiu.com/rank/yuepiao',
    bookIdRegex: '\\/book\\/(\\d+)',
    selectors: {
      listItem: '.book-list .book-item, .rank-list li',
      title: '.book-name a, .name a',
      author: '.author a, .book-author',
      category: '.book-cate, .cate',
      intro: '.book-intro, .intro',
      link: '.book-name a, .name a',
      rankBadge: '.num, .rank-num',
    },
  },
  book: {
    urlTemplate: 'https://www.hongxiu.com/book/${id}',
    freeStrategy: 'first-n',
    selectors: {
      title: '.book-info h1, .book-name',
      author: '.book-info .author a, .author',
      intro: '.book-intro, .book-info-intro',
      tag: '.book-info .tag a, .tags a',
      chapterListItem: '.chapter-list li, .catalog-list li',
      chapterFreeBadge: '.free, .badge-free',
      chapterLink: 'a',
    },
    reader: {
      title: '.chapter-title, h1',
      content: '.chapter-content, .read-text',
    },
  },
  reviews: {
    pageUrlExpr: '`${url}#comment`',
    selectors: {
      listItem: '.comment-list .comment-item',
      text: '.comment-content',
      likes: '.like-count, .praise',
    },
  },
};

export const ALL_PLATFORM_CONFIGS: Record<string, PlatformConfig> = {
  fanqie: FANQIE,
  qidian: QIDIAN,
  jjwxc: JJWXC,
  qimao: QIMAO,
  faloo: FALOO,
  zongheng: ZONGHENG,
  '17k': SEVENTEEN_K,
  ciweimao: CIWEIMAO,
  sfacg: SFACG,
  hongxiu: HONGXIU,
};
