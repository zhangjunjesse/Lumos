import { parseProductFromHtml, isParsedProductSufficient } from '../url-adapters';

describe('generic URL adapter (JSON-LD + OG)', () => {
  it('uses JSON-LD when present', () => {
    const html = `<html><head>
      <title>Random Store</title>
      <script type="application/ld+json">
      {"@context":"https://schema.org","@type":"Product","name":"Headphones X","image":["https://example.com/img/main.jpg","https://example.com/img/2.jpg"],"description":"Wireless ANC over-ear","brand":{"@type":"Brand","name":"Sonix"},"offers":{"@type":"Offer","price":"199","priceCurrency":"USD"},"aggregateRating":{"@type":"AggregateRating","ratingValue":"4.6","reviewCount":"888"}}
      </script>
    </head><body><h1>Headphones X</h1></body></html>`;
    const { product, adapter, sufficient } = parseProductFromHtml('https://random.shop/p/x', html);
    // Headphones X has bullets=0 and no description-only-bullet — but description is present, so isParsedProductSufficient passes.
    expect(adapter.id).toBe('generic');
    expect(sufficient).toBe(true);
    expect(product.title).toBe('Headphones X');
    expect(product.mainImage).toBe('https://example.com/img/main.jpg');
    expect(product.gallery).toContain('https://example.com/img/2.jpg');
    expect(product.brand).toBe('Sonix');
    expect(product.price).toBe('USD 199');
    expect(product.rating).toBe('4.6');
    expect(product.reviewsCount).toBe('888');
    expect(product.description).toMatch(/Wireless ANC/);
  });

  it('falls back to OpenGraph when no JSON-LD', () => {
    const html = `<html><head>
      <title>Demo Store</title>
      <meta property="og:title" content="Eco Tote Bag"/>
      <meta property="og:image" content="https://cdn.example/eco.jpg"/>
      <meta property="og:description" content="Recycled canvas tote"/>
      <meta property="product:price:amount" content="19.50"/>
      <meta property="product:price:currency" content="EUR"/>
    </head><body></body></html>`;
    const { product, sufficient } = parseProductFromHtml('https://shop.example/eco', html);
    expect(product.title).toBe('Eco Tote Bag');
    expect(product.mainImage).toBe('https://cdn.example/eco.jpg');
    expect(product.price).toBe('EUR 19.50');
    expect(product.description).toBe('Recycled canvas tote');
    // Sufficient because title + mainImage + description is set.
    expect(sufficient).toBe(true);
  });

  it('marks as insufficient when only title is found', () => {
    const html = `<html><head><title>Empty page</title></head><body></body></html>`;
    const { product, sufficient } = parseProductFromHtml('https://x.test/', html);
    expect(product.title).toBe('Empty page');
    expect(product.mainImage).toBeNull();
    expect(sufficient).toBe(false);
    expect(isParsedProductSufficient(product)).toBe(false);
  });

  it('resolves relative image URLs against the page URL', () => {
    const html = `<html><head>
      <script type="application/ld+json">
      {"@type":"Product","name":"Mug","image":"/cdn/mug.png","description":"Ceramic"}
      </script>
    </head></html>`;
    const { product } = parseProductFromHtml('https://shop.example/p/mug?x=1', html);
    expect(product.mainImage).toBe('https://shop.example/cdn/mug.png');
  });
});
