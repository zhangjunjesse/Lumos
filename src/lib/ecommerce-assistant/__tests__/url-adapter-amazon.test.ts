import { parseProductFromHtml } from '../url-adapters';

const AMAZON_URL = 'https://www.amazon.com/dp/B09TESTSKU';

const AMAZON_HTML = `
<html><head>
<title>ACME Stainless Steel Water Bottle 32oz | Amazon.com</title>
<meta property="og:title" content="ACME Stainless Steel Water Bottle 32oz"/>
<meta property="og:image" content="https://m.media-amazon.com/images/I/og-thumb.jpg"/>
<meta property="og:description" content="32 oz double wall vacuum insulated"/>
<script type="application/ld+json">
{"@type":"Product","name":"ACME Stainless Steel Water Bottle 32oz","brand":"ACME","image":["https://m.media-amazon.com/images/I/jsonld.jpg"],"description":"32 oz double wall","offers":{"@type":"Offer","price":"29.99","priceCurrency":"USD"}}
</script>
</head><body>
<span id="productTitle">  ACME Stainless Steel Water Bottle 32oz - Vacuum Insulated </span>
<a id="bylineInfo">Visit the ACME Store</a>
<img id="landingImage"
  src="https://m.media-amazon.com/images/I/small.jpg"
  data-old-hires="https://m.media-amazon.com/images/I/hi-res.jpg"
  data-a-dynamic-image="{&quot;https://m.media-amazon.com/images/I/wide.jpg&quot;:[1500,1500],&quot;https://m.media-amazon.com/images/I/small.jpg&quot;:[400,400]}" />
<div id="feature-bullets">
  <ul>
    <li><span class="a-list-item">Holds 32 ounces of cold or hot liquid for over 24 hours.</span></li>
    <li><span class="a-list-item">Made from food-grade 18/8 stainless steel.</span></li>
    <li><span class="a-list-item">Sweat-proof exterior keeps your hands and bag dry.</span></li>
  </ul>
</div></div>
<div id="productDescription">A premium daily-carry insulated bottle.</div>
<span id="acrCustomerReviewText">12,345 ratings</span>
<span class="a-icon-alt">4.7 out of 5 stars</span>
<span class="a-offscreen">$29.99</span>
</body></html>
`;

describe('amazon URL adapter', () => {
  it('extracts hi-res hero image, bullets, brand, price, rating', () => {
    const { product, adapter, sufficient } = parseProductFromHtml(AMAZON_URL, AMAZON_HTML);
    expect(adapter.id).toBe('amazon');
    expect(sufficient).toBe(true);
    expect(product.title).toContain('ACME Stainless Steel Water Bottle');
    // landingImage data-old-hires has highest priority over OG thumbnail.
    expect(product.mainImage).toBe('https://m.media-amazon.com/images/I/hi-res.jpg');
    expect(product.bullets.length).toBeGreaterThanOrEqual(3);
    expect(product.bullets[0]).toMatch(/32 ounces/);
    // JSON-LD wins over the bylineInfo string when both are present (more canonical).
    expect(product.brand).toBe('ACME');
    // JSON-LD currency is canonical; the a-offscreen $29.99 is a display variant.
    expect(product.price).toBe('USD 29.99');
    expect(product.rating).toBe('4.7');
    expect(product.reviewsCount).toBe('12,345');
    // JSON-LD description wins over the productDescription block.
    expect(product.description).toMatch(/double wall/);
  });

  it('picks the largest image when only data-a-dynamic-image is present', () => {
    const html = AMAZON_HTML.replace('data-old-hires="https://m.media-amazon.com/images/I/hi-res.jpg"', '');
    const { product } = parseProductFromHtml(AMAZON_URL, html);
    expect(product.mainImage).toBe('https://m.media-amazon.com/images/I/wide.jpg');
  });
});
