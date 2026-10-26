import type { OrderLine } from './model';
import { orderEconomics, summarizeOrders, vatIncluded } from './order-economics';

const order = (patch: Partial<OrderLine> = {}): OrderLine => ({
  id: 'ord_1',
  stripeRef: 'pi_test',
  createdAt: '2026-10-26T09:00:00.000Z',
  productId: 'prd_lamp',
  productTitle: 'LED-skrivbordslampa',
  productKind: 'PHYSICAL',
  quantity: 1,
  grossOre: 49_900,
  vatRateBp: 2_500,
  refundedOre: 0,
  paymentFeeOre: 929,
  cogsOre: 13_200,
  shippingOre: 4_900,
  adCostOre: 5_500,
  status: 'FULFILLED',
  ...patch,
});

describe('vatIncluded', () => {
  it('extracts 25 % and 6 % VAT from VAT-inclusive prices', () => {
    expect(vatIncluded(49_900, 2_500)).toBe(9_980);
    expect(vatIncluded(12_900, 600)).toBe(730);
    expect(vatIncluded(10_000, 0)).toBe(0);
  });
});

describe('orderEconomics', () => {
  it('derives net revenue, contribution and margin from the raw Stripe numbers', () => {
    const result = orderEconomics(order());
    expect(result.netRevenueOre).toBe(39_920);
    expect(result.variableCostOre).toBe(929 + 13_200 + 4_900 + 5_500);
    expect(result.contributionOre).toBe(39_920 - 24_529);
    expect(result.marginBp).toBe(3_855);
  });

  it('gives a digital product its high margin', () => {
    const result = orderEconomics(
      order({
        productKind: 'DIGITAL',
        grossOre: 14_900,
        cogsOre: 0,
        shippingOre: 0,
        paymentFeeOre: 404,
        adCostOre: 0,
      }),
    );
    expect(result.netRevenueOre).toBe(11_920);
    expect(result.marginBp).toBe(9_661);
  });

  it('keeps fees and costs after a full refund, so the order shows as a loss', () => {
    const result = orderEconomics(order({ refundedOre: 49_900, status: 'REFUNDED' }));
    expect(result.netRevenueOre).toBe(0);
    expect(result.contributionOre).toBe(-24_529);
    expect(result.marginBp).toBeNull();
  });
});

describe('summarizeOrders', () => {
  it('adds up the economics of many orders', () => {
    const totals = summarizeOrders([order(), order({ id: 'ord_2', refundedOre: 49_900 })]);
    expect(totals).toMatchObject({
      orderCount: 2,
      grossOre: 99_800,
      refundsOre: 49_900,
      netSalesOre: 39_920,
      cogsOre: 26_400,
      attributedAdOre: 11_000,
    });
  });
});
