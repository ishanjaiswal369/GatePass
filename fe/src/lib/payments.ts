/**
 * The one place the app takes money.
 *
 * Every screen that charges -- checkout, extra time -- calls `payForBooking`
 * and renders whatever outcome comes back, so wiring a gateway is a change to
 * this file and nothing else. Cashfree is the gateway; it is not wired yet.
 *
 * Whatever the gateway reports here is only what the driver saw. The booking
 * becomes CONFIRMED on the API, from the gateway's server-to-server
 * notification, never because this function returned PAID: a response from
 * the device can be forged, a webhook signed by the gateway cannot.
 */

export type PaymentMethod = "UPI" | "UPI_SAVED" | "CARD" | "NETBANKING";

export type PaymentOutcome =
  /** The gateway reported success. Refresh the booking to see it confirmed. */
  | { status: "PAID" }
  /** The gateway declined or errored; nothing was booked. */
  | { status: "FAILED"; message: string }
  /** The driver closed the gateway before finishing. */
  | { status: "CANCELLED" }
  /** No gateway is wired in this build. */
  | { status: "NOT_CONFIGURED" };

/** False until a gateway is wired, so screens can say so up front. */
export const paymentsConfigured = false;

export async function payForBooking(_input: {
  token: string;
  bookingId: string;
  /** Rupees, as the API quoted them. Shown to the driver, never trusted by the server. */
  amount: string;
  method: PaymentMethod;
}): Promise<PaymentOutcome> {
  // Cashfree: ask the API to create an order for this booking, open the
  // checkout with the session it returns, and map the checkout's result to a
  // PaymentOutcome. The amount is set by the API, not taken from here.
  return { status: "NOT_CONFIGURED" };
}

/**
 * Paying for a monthly reservation (Phase 6): the whole term, once. Its own
 * call because it pays a different thing -- the API will create the
 * gateway order against the reservation, not a booking. Same outcomes.
 */
export async function payForMonthly(_input: {
  token: string;
  reservationId: string;
  /** Rupees, as the API quoted them. Shown to the driver, never trusted by the server. */
  amount: string;
  method: PaymentMethod;
}): Promise<PaymentOutcome> {
  // Cashfree: as payForBooking, with the order created for the reservation.
  return { status: "NOT_CONFIGURED" };
}

/** A method the gateway has saved for this driver, as it describes it. */
export interface SavedPaymentMethod {
  id: string;
  kind: "UPI" | "CARD";
  /** "ishan@okhdfcbank", "Visa •••• 3012" -- the gateway's masked form, never raw. */
  label: string;
  /** "Expires 08/28", "Used last on 18 Sep". */
  detail?: string;
  isDefault?: boolean;
}

/**
 * Methods the gateway holds for this driver. Card numbers and UPI handles
 * live with the gateway (tokenised), not in GatePass's database, so this is
 * a gateway call like payForBooking. Empty until one is wired.
 */
export async function listSavedMethods(_token: string): Promise<SavedPaymentMethod[]> {
  // Cashfree: fetch the customer's saved instruments and map them here.
  return [];
}
