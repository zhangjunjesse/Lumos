import { parseProductFromHtml } from '../url-adapters';

describe('etsy url adapter', () => {
  it('extracts public listing fields from rendered Etsy detail HTML', () => {
    const html = `
      <html>
        <head>
          <meta property="product:price:amount" content="35.00" />
          <meta property="product:price:currency" content="USD" />
          <script type="application/ld+json">
            {
              "@context": "https://schema.org",
              "@type": "Product",
              "name": "Custom Pet Portrait Mug Personalized",
              "image": [
                "https://i.etsystatic.com/111/r/il/aaaa/6000000001/il_fullxfull.6000000001_abcd.jpg",
                "https://i.etsystatic.com/111/r/il/bbbb/6000000002/il_fullxfull.6000000002_efgh.jpg"
              ],
              "description": "Personalized pet portrait mug from your photo.",
              "offers": {"@type": "Offer", "price": "35.00", "priceCurrency": "USD"},
              "aggregateRating": {"@type": "AggregateRating", "ratingValue": "4.9", "reviewCount": "126"}
            }
          </script>
        </head>
        <body>
          <nav aria-label="Breadcrumb">
            <a>Home & Living</a>
            <a>Kitchen & Dining</a>
            <a>Mugs</a>
          </nav>
          <a href="/shop/PetPortraitStudio">PetPortraitStudio</a>
          <div data-buy-box-region="price">
            <span class="currency-symbol">$</span><span class="currency-value">35.00</span>
          </div>
          <span aria-label="4.9 out of 5 stars"></span>
          <a href="#reviews">126 reviews</a>
          <img data-src-zoom-image="https://i.etsystatic.com/111/r/il/cccc/6000000003/il_fullxfull.6000000003_ijkl.jpg" />
          <img
            src="https://i.etsystatic.com/111/r/il/dddd/6000000004/il_340x270.6000000004_mnop.jpg"
            srcset="https://i.etsystatic.com/111/r/il/dddd/6000000004/il_794xN.6000000004_mnop.jpg 1x, https://i.etsystatic.com/111/r/il/dddd/6000000004/il_fullxfull.6000000004_mnop.jpg 2x"
          />
          <section>
            <div id="wt-content-toggle-product-details-read-more">
              <p>Custom pet portrait mug printed from your uploaded pet photo.</p>
              <p>Dishwasher safe ceramic cup, gift ready packaging.</p>
            </div>
          </section>
        </body>
      </html>
    `;

    const out = parseProductFromHtml(
      'https://www.etsy.com/listing/4435974765/custom-pet-portrait-mug-personalized',
      html,
    );

    expect(out.adapter.id).toBe('etsy');
    expect(out.product.title).toBe('Custom Pet Portrait Mug Personalized');
    expect(out.product.price).toBe('USD 35.00');
    expect(out.product.rating).toBe('4.9');
    expect(out.product.reviewsCount).toBe('126');
    expect(out.product.brand).toBe('PetPortraitStudio');
    expect(out.product.category).toBe('Mugs');
    expect(out.product.description).toContain('Personalized pet portrait mug');
    expect(out.product.mainImage).toContain('il_fullxfull.6000000001_abcd.jpg');
    expect(out.product.gallery).toContain(
      'https://i.etsystatic.com/111/r/il/cccc/6000000003/il_fullxfull.6000000003_ijkl.jpg',
    );
  });
});
