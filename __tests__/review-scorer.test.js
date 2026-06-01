const { scoreReview } = require('../classifier');

jest.mock('../logger', () => ({ debugLog: () => {}, logError: () => {} }));

describe('scoreReview (Track G)', () => {
  test('returns not slop for text below min length', async () => {
    const r = await scoreReview('short', { productTitle: 'USB Hub' });
    expect(r.isSlop).toBe(false);
    expect(r.confidence).toBe(0);
  });

  test('flags generic 5-star spam without product details', async () => {
    const text = 'This product is amazing! Five stars! Highly recommend! A total game changer. Must-have purchase.';
    const r = await scoreReview(text, {
      stars: 5,
      verifiedPurchase: false,
      productTitle: 'Wireless Ergonomic Mouse MX-450',
      siblingReviewTexts: [],
    });
    expect(r.isSlop).toBe(true);
    expect(r.reasons.length).toBeGreaterThanOrEqual(1);
  });

  test('passes verified review with product token and use detail (Amazon FP fix)', async () => {
    const text = 'This USB-C hub works well at my desk. I use it every day for work and travel. Verified purchase — reliable hub for my laptop.';
    const r = await scoreReview(text, {
      stars: 5,
      verifiedPurchase: true,
      productTitle: 'USB-C Hub 7-in-1 Adapter',
      siblingReviewTexts: [],
    });
    expect(r.isSlop).toBe(false);
  });

  test('flags review farm overlap with siblings', async () => {
    const text = 'Amazing product exceeded expectations highly recommend five stars best purchase ever';
    const sibling = 'Amazing product exceeded expectations highly recommend five stars wonderful purchase ever';
    const r = await scoreReview(text, {
      stars: 5,
      productTitle: 'Phone Case',
      siblingReviewTexts: [sibling, sibling],
    });
    expect(r.isSlop).toBe(true);
    expect(r.reasons.some(x => /overlap/i.test(x))).toBe(true);
  });

  test('returns reasons array capped for UI', async () => {
    const text = 'Changed my life! Game changer! Must-have! Five stars! Highly recommend! Exceeded expectations!';
    const r = await scoreReview(text, {
      stars: 5,
      productTitle: 'Gadget',
      siblingReviewTexts: [],
    });
    expect(r.reasons.length).toBeLessThanOrEqual(4);
  });
});
