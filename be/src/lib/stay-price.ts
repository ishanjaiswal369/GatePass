import { Prisma } from "@prisma/client";
import { pricing } from "../config/pricing.js";

/**
 * What a stay on a host spot costs, and what the driver pays on top.
 *
 * One function for every place a price is shown or charged -- search
 * results, the checkout quote, the booking itself -- so the number a driver
 * sees on a card is the number they are asked to pay.
 */

export interface SpotRates {
  /** Null when the host doesn't rent by the hour. */
  pricePerHour: Prisma.Decimal | null;
  pricePerDay: Prisma.Decimal | null;
}

export type PriceBasis = "HOURLY" | "DAILY";

/**
 * The parking amount for `minutes` on these rates, or null when these rates
 * don't sell a stay at all (no hourly or daily rate).
 *
 * Whole days are charged the day rate when the host offers one; what is left
 * over is charged the cheaper of its hours and one more day. So a 7-hour stay
 * at ₹50/h with a ₹250 day rate costs ₹250, not ₹350, and a 30-hour stay
 * costs a day plus six hours. Hours are billed by the minute: rounding a part
 * hour up would make a 61-minute stay cost two. A space with a day rate and
 * no hourly rate charges each started day.
 */
export function stayPrice(rates: SpotRates, minutes: number): { amount: Prisma.Decimal; basis: PriceBasis } | null {
  const { pricePerHour, pricePerDay } = rates;
  if (!pricePerHour && !pricePerDay) return null;

  if (!pricePerHour) {
    return { amount: pricePerDay!.mul(Math.ceil(minutes / (24 * 60))).toDecimalPlaces(2), basis: "DAILY" };
  }

  const hourly = (mins: number) => pricePerHour.mul(mins).div(60);

  if (!pricePerDay) {
    return { amount: hourly(minutes).toDecimalPlaces(2), basis: "HOURLY" };
  }

  const fullDays = Math.floor(minutes / (24 * 60));
  const rest = minutes % (24 * 60);
  const restHourly = hourly(rest);
  const restCharge = Prisma.Decimal.min(restHourly, rest > 0 ? pricePerDay : new Prisma.Decimal(0));
  const amount = pricePerDay.mul(fullDays).add(restCharge).toDecimalPlaces(2);
  const usedDayRate = fullDays > 0 || (rest > 0 && restCharge.lessThan(restHourly));

  return { amount, basis: usedDayRate ? "DAILY" : "HOURLY" };
}

export interface Fees {
  platformFee: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
}

/** GatePass's fee to the driver and the GST on it (config/pricing.ts). */
export function driverFees(): Fees {
  const platformFee = new Prisma.Decimal(pricing.platformFee);
  const taxAmount = platformFee.mul(pricing.platformFeeGstRate).toDecimalPlaces(2);
  return { platformFee, taxAmount };
}

/** Of rates across vehicle types, the one that makes this stay cheapest. */
export function cheapestStay(rows: SpotRates[], minutes: number): Prisma.Decimal | null {
  return rows.reduce<Prisma.Decimal | null>((best, row) => {
    const price = stayPrice(row, minutes);
    if (!price) return best;
    return best === null || price.amount.lessThan(best) ? price.amount : best;
  }, null);
}
