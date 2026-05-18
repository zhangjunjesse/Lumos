/**
 * 内置 Etsy 类目清单（精选静态树）。
 *
 * Lumos 无 Etsy Open API → 拿不到官方 6000+ 节点 taxonomy 树。用户已确认
 * 采用"内置大类清单下钻"：这里维护一份精选的 Etsy 顶级大类 + 代表性子类，
 * 每个节点带一个英文搜索词（Etsy 站内搜索/采集入口）。这是**种子树**，不是
 * 官方全量树——叶子层是策划的常见细分，不追求穷尽（诚实边界，UI 会注明）。
 *
 * 选择语义：选任一节点 = 纳入它（有子节点则纳入其全部叶子）的搜索词作为
 * 采集入口。
 */
export interface CatalogNode {
  id: string;
  name: string;
  /** Etsy 站内搜索词（英文）。叶子必有；父节点亦给一个聚合词作兜底。 */
  query: string;
  children?: CatalogNode[];
}

export const ETSY_CATEGORY_CATALOG: CatalogNode[] = [
  {
    id: 'home-living', name: 'Home & Living', query: 'home decor',
    children: [
      { id: 'wall-decor', name: 'Wall Decor', query: 'wall decor', children: [
        { id: 'wall-hangings', name: 'Wall Hangings', query: 'macrame wall hanging' },
        { id: 'tapestries', name: 'Tapestries', query: 'wall tapestry' },
        { id: 'prints-posters', name: 'Prints & Posters', query: 'art print poster' },
      ]},
      { id: 'kitchen-dining', name: 'Kitchen & Dining', query: 'kitchen dining', children: [
        { id: 'drinkware', name: 'Drinkware', query: 'personalized mug' },
        { id: 'cutting-boards', name: 'Cutting Boards', query: 'engraved cutting board' },
      ]},
      { id: 'candles-holders', name: 'Candles & Holders', query: 'soy candle handmade' },
      { id: 'home-organization', name: 'Storage & Organization', query: 'home organization' },
    ],
  },
  {
    id: 'jewelry', name: 'Jewelry', query: 'handmade jewelry',
    children: [
      { id: 'necklaces', name: 'Necklaces', query: 'personalized necklace' },
      { id: 'rings', name: 'Rings', query: 'handmade ring' },
      { id: 'earrings', name: 'Earrings', query: 'statement earrings' },
      { id: 'bracelets', name: 'Bracelets', query: 'beaded bracelet' },
    ],
  },
  {
    id: 'clothing', name: 'Clothing', query: 'handmade clothing',
    children: [
      { id: 'tshirts', name: 'T-shirts', query: 'graphic tee' },
      { id: 'sweatshirts', name: 'Sweatshirts & Hoodies', query: 'embroidered sweatshirt' },
      { id: 'baby-clothing', name: 'Baby & Toddler', query: 'baby clothes personalized' },
    ],
  },
  {
    id: 'accessories', name: 'Accessories', query: 'accessories handmade',
    children: [
      { id: 'hair-accessories', name: 'Hair Accessories', query: 'hair clip handmade' },
      { id: 'keychains', name: 'Keychains', query: 'personalized keychain' },
      { id: 'hats', name: 'Hats', query: 'knit beanie' },
    ],
  },
  {
    id: 'art-collectibles', name: 'Art & Collectibles', query: 'wall art',
    children: [
      { id: 'painting', name: 'Painting', query: 'original painting' },
      { id: 'digital-prints', name: 'Digital Prints', query: 'printable wall art' },
      { id: 'drawing-illustration', name: 'Drawing & Illustration', query: 'custom portrait illustration' },
    ],
  },
  {
    id: 'bags-purses', name: 'Bags & Purses', query: 'handmade bag',
    children: [
      { id: 'totes', name: 'Totes', query: 'canvas tote bag' },
      { id: 'pouches', name: 'Pouches & Coin Purses', query: 'zipper pouch' },
      { id: 'backpacks', name: 'Backpacks', query: 'handmade backpack' },
    ],
  },
  {
    id: 'wedding-party', name: 'Weddings & Party', query: 'wedding decor',
    children: [
      { id: 'wedding-decor', name: 'Wedding Decorations', query: 'wedding sign personalized' },
      { id: 'party-supplies', name: 'Party Supplies', query: 'party decorations' },
      { id: 'invitations', name: 'Invitations & Paper', query: 'wedding invitation template' },
    ],
  },
  {
    id: 'toys-games', name: 'Toys & Games', query: 'handmade toys',
    children: [
      { id: 'plushies', name: 'Stuffed Animals & Plushies', query: 'crochet plushie' },
      { id: 'wooden-toys', name: 'Wooden Toys', query: 'wooden montessori toy' },
      { id: 'puzzles', name: 'Puzzles & Games', query: 'handmade puzzle' },
    ],
  },
  {
    id: 'craft-supplies', name: 'Craft Supplies & Tools', query: 'craft supplies',
    children: [
      { id: 'beads-charms', name: 'Beads & Charms', query: 'jewelry making beads' },
      { id: 'patterns', name: 'Patterns & Tutorials', query: 'crochet pattern pdf' },
      { id: 'fabric-yarn', name: 'Fabric & Yarn', query: 'hand dyed yarn' },
    ],
  },
  {
    id: 'bath-beauty', name: 'Bath & Beauty', query: 'handmade soap',
    children: [
      { id: 'soaps', name: 'Soaps', query: 'natural handmade soap' },
      { id: 'skincare', name: 'Skin Care', query: 'organic skincare' },
      { id: 'hair-care', name: 'Hair Care', query: 'handmade hair care' },
    ],
  },
  {
    id: 'pet-supplies', name: 'Pet Supplies', query: 'pet supplies',
    children: [
      { id: 'pet-accessories', name: 'Collars & Accessories', query: 'personalized dog collar' },
      { id: 'pet-beds', name: 'Beds & Furniture', query: 'pet bed handmade' },
      { id: 'pet-toys', name: 'Pet Toys', query: 'handmade pet toy' },
    ],
  },
  {
    id: 'paper-party', name: 'Paper & Party Supplies', query: 'stationery',
    children: [
      { id: 'planners', name: 'Planners & Calendars', query: 'planner printable' },
      { id: 'cards', name: 'Greeting Cards', query: 'handmade greeting card' },
      { id: 'stickers', name: 'Stickers', query: 'vinyl stickers' },
    ],
  },
];

function walk(nodes: CatalogNode[], visit: (n: CatalogNode, parents: CatalogNode[]) => void, parents: CatalogNode[] = []): void {
  for (const n of nodes) {
    visit(n, parents);
    if (n.children?.length) walk(n.children, visit, [...parents, n]);
  }
}

export function findCatalogNode(id: string): CatalogNode | null {
  let found: CatalogNode | null = null;
  walk(ETSY_CATEGORY_CATALOG, (n) => {
    if (n.id === id) found = n;
  });
  return found;
}

export function catalogNodePath(id: string): string[] {
  let path: string[] = [];
  walk(ETSY_CATEGORY_CATALOG, (n, parents) => {
    if (n.id === id) path = [...parents.map((p) => p.name), n.name];
  });
  return path;
}

/** 选中的节点 id 集合 → 去重后的采集目标（叶子粒度，含路径）。 */
export interface CatalogTarget {
  id: string;
  name: string;
  path: string[];
  query: string;
}

export function resolveCatalogTargets(selectedIds: string[]): CatalogTarget[] {
  const out = new Map<string, CatalogTarget>();
  for (const id of selectedIds) {
    const node = findCatalogNode(id);
    if (!node) continue;
    const leaves: CatalogNode[] = [];
    walk([node], (n) => {
      if (!n.children?.length) leaves.push(n);
    });
    // 节点本身是父但用户只选了它 → 用其所有叶子；叶子 → 自身。
    const targets = leaves.length > 0 ? leaves : [node];
    for (const leaf of targets) {
      if (out.has(leaf.id)) continue;
      out.set(leaf.id, {
        id: leaf.id,
        name: leaf.name,
        path: catalogNodePath(leaf.id),
        query: leaf.query,
      });
    }
  }
  return [...out.values()];
}

/**
 * 每个节点 id → 它最终展开到的叶子 id 列表（叶子 → [自身]）。
 * 供选择器做叶子级勾选与父节点三态（全选/部分/未选）派生：让"勾父类"
 * 即勾选其全部细分（树视觉与实际采集一致，且可单独排除某叶子）。
 */
export function buildLeafIndex(): Map<string, string[]> {
  const idx = new Map<string, string[]>();
  walk(ETSY_CATEGORY_CATALOG, (n) => {
    const leaves: string[] = [];
    walk([n], (m) => {
      if (!m.children?.length) leaves.push(m.id);
    });
    idx.set(n.id, leaves);
  });
  return idx;
}
