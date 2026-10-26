import type { OrderLine } from './model';
import { basisPoints, type Ore } from './money';

/*
 * Per-order unit economics. The dashboard recomputes these on every snapshot, so the margin you
 * see is always derived from the raw Stripe numbers – never a stored, possibly stale, figure.
 */

export interface OrderEconomics {
  /** What the customer paid minus refunds, VAT included. */
  readonly retainedGrossOre: Ore;
  readonly vatOre: Ore;
  readonly netRevenueOre: Ore;
  readonly variableCostOre: Ore;
  /** Täckningsbidrag. */
  readonly contributionOre: Ore;
  /** Contribution margin in basis points; null without net revenue (e.g. fully refunded). */
  readonly marginBp: number | null;
}

/** The VAT contained in a VAT-inclusive amount: 499 kr at 25 % holds 99,80 kr. */
export function vatIncluded(grossOre: Ore, vatRateBp: number): Ore {
  return Math.round((grossOre * vatRateBp) / (10_000 + vatRateBp));
}

/**
 * Refunds return the VAT on the refunded part, but not Stripe's fee, the supplier cost, the
 * shipping or the ad spend that won the order.
 */
export function orderEconomics(order: OrderLine): OrderEconomics {
  const retainedGrossOre = order.grossOre - order.refundedOre;
  const vatOre = vatIncluded(retainedGrossOre, order.vatRateBp);
  const netRevenueOre = retainedGrossOre - vatOre;
  const variableCostOre = order.paymentFeeOre + order.cogsOre + order.shippingOre + order.adCostOre;
  const contributionOre = netRevenueOre - variableCostOre;
  return {
    retainedGrossOre,
    vatOre,
    netRevenueOre,
    variableCostOre,
    contributionOre,
    marginBp: netRevenueOre > 0 ? basisPoints(contributionOre, netRevenueOre) : null,
  };
}

export interface OrderTotals {
  readonly orderCount: number;
  readonly grossOre: Ore;
  readonly refundsOre: Ore;
  readonly vatOre: Ore;
  readonly netSalesOre: Ore;
  readonly cogsOre: Ore;
  readonly shippingOre: Ore;
  readonly paymentFeesOre: Ore;
  readonly attributedAdOre: Ore;
}

export function summarizeOrders(orders: Iterable<OrderLine>): OrderTotals {
  let orderCount = 0;
  let grossOre = 0;
  let refundsOre = 0;
  let vatOre = 0;
  let netSalesOre = 0;
  let cogsOre = 0;
  let shippingOre = 0;
  let paymentFeesOre = 0;
  let attributedAdOre = 0;
  for (const order of orders) {
    const economics = orderEconomics(order);
    orderCount += 1;
    grossOre += order.grossOre;
    refundsOre += order.refundedOre;
    vatOre += economics.vatOre;
    netSalesOre += economics.netRevenueOre;
    cogsOre += order.cogsOre;
    shippingOre += order.shippingOre;
    paymentFeesOre += order.paymentFeeOre;
    attributedAdOre += order.adCostOre;
  }
  return {
    orderCount,
    grossOre,
    refundsOre,
    vatOre,
    netSalesOre,
    cogsOre,
    shippingOre,
    paymentFeesOre,
    attributedAdOre,
  };
}
