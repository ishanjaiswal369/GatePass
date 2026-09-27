import * as ExpoLinking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { Linking, Platform } from "react-native";
import { UserError } from "@/lib/userError";
import type { PaymentCheckout, PaymentClientHints, UpiApp } from "@/types/api.types";

/**
 * The one place the app takes money.
 *
 * UPI is started by the API (POST /bookings/:id/pay/upi), which hands back
 * links into UPI apps or a QR. Card -- sandbox only for now -- goes from here
 * straight to the gateway with the order's session id, so a card number never
 * reaches GatePass's servers.
 *
 * Nothing here decides that a booking is paid. It becomes CONFIRMED on the
 * API, from the gateway's word, and the pay screen reads it from there: what
 * a phone reports can be forged, a gateway's server-to-server answer cannot.
 */

export type PaymentMethod = "UPI" | "CARD";

export type PaymentOutcome =
  /** The gateway reported success. Refresh the booking to see it confirmed. */
  | { status: "PAID" }
  /** The gateway declined or errored; nothing was booked. */
  | { status: "FAILED"; message: string }
  /** The driver closed the gateway before finishing. */
  | { status: "CANCELLED" }
  /** No gateway is wired for this. */
  | { status: "NOT_CONFIGURED" };

/**
 * Extra time is held but not yet sold through the gateway: its orders come
 * with a later step, so the extension screen keeps saying so.
 */
export async function payForExtension(): Promise<PaymentOutcome> {
  return { status: "NOT_CONFIGURED" };
}

// ---- where the driver is paying from ----

const userAgent = () => (Platform.OS === "web" && typeof navigator !== "undefined" ? navigator.userAgent : "");

/** Android and iPhone -- app or phone browser -- open UPI apps; a desktop browser shows a QR. */
export type PayPlatform = "android" | "ios" | "desktop";

export function payPlatform(): PayPlatform {
  if (Platform.OS === "android") return "android";
  if (Platform.OS === "ios") return "ios";
  const ua = userAgent();
  if (/android/i.test(ua)) return "android";
  if (/iphone|ipad|ipod/i.test(ua)) return "ios";
  return "desktop";
}

/** INTENT opens a UPI app on this device; QR is for paying from another one. */
export const upiChannelFor = (platform: PayPlatform) => (platform === "desktop" ? "QR" : "INTENT");

export const UPI_APP_LABELS: Record<UpiApp, string> = {
  default: "Any UPI app",
  gpay: "Google Pay",
  phonepe: "PhonePe",
  paytm: "Paytm",
  bhim: "BHIM",
};

/**
 * The apps offered on each phone. Android's `upi://` link opens the phone's
 * own chooser, so "Any UPI app" comes first there. iOS has no such chooser --
 * a generic UPI link opens whichever app claimed it last -- so each app is
 * named instead.
 */
export function upiAppsFor(platform: PayPlatform): UpiApp[] {
  if (platform === "android") return ["default", "gpay", "phonepe", "paytm", "bhim"];
  if (platform === "ios") return ["gpay", "phonepe", "paytm", "bhim"];
  return [];
}

/** What the gateway is told about this device; it shapes the UPI flow it answers with. */
export function clientHints(): PaymentClientHints {
  if (Platform.OS === "android" || Platform.OS === "ios") {
    return { device: "mobile", os: Platform.OS, rendering: "native", browser: "others" };
  }

  const ua = userAgent();
  const platform = payPlatform();
  const os = /android/i.test(ua)
    ? "android"
    : /iphone|ipad|ipod/i.test(ua)
      ? "ios"
      : /windows/i.test(ua)
        ? "windows"
        : /mac os/i.test(ua)
          ? "macos"
          : /linux/i.test(ua)
            ? "linux"
            : "others";
  // Order matters: Edge's agent also says Chrome, Chrome's also says Safari.
  const browser = /edg\//i.test(ua)
    ? "edge"
    : /firefox|fxios/i.test(ua)
      ? "firefox"
      : /chrome|crios/i.test(ua)
        ? "chrome"
        : /safari/i.test(ua)
          ? "safari"
          : "others";

  return platform === "desktop" ? { device: "desktop", os, browser } : { device: "mobile", os, rendering: "mweb", browser };
}

// ---- opening what the gateway gave us ----

/** Links the API already allow-listed; checked again before anything opens one. */
const UPI_SCHEMES = ["upi:", "tez:", "gpay:", "phonepe:", "paytmmp:", "paytm:", "bhim:"];

function isGatewayPage(link: string): boolean {
  try {
    const url = new URL(link);
    return url.protocol === "https:" && (url.hostname === "cashfree.com" || url.hostname.endsWith(".cashfree.com"));
  } catch {
    return false;
  }
}

/**
 * Opens a UPI app with the payment. In the sandbox the "app" is Cashfree's
 * payment simulator, a web page, so it opens in a browser instead.
 *
 * False when it couldn't be opened -- usually the app isn't installed -- so
 * the screen can say so and offer another.
 */
export async function openUpiApp(link: string): Promise<boolean> {
  try {
    if (isGatewayPage(link)) {
      if (Platform.OS === "web") {
        // Not the "noopener" feature: with it window.open always returns null,
        // and a blocked popup couldn't be told apart from an opened one.
        const opened = window.open(link, "_blank");
        if (opened) opened.opener = null;
        return opened !== null;
      }
      // Not awaited: on iOS it resolves only when the sheet is closed, and the
      // pay screen keeps checking the booking meanwhile.
      void WebBrowser.openBrowserAsync(link);
      return true;
    }
    if (!UPI_SCHEMES.some((scheme) => link.startsWith(scheme))) return false;
    if (Platform.OS === "web") {
      window.location.href = link;
      return true;
    }
    await Linking.openURL(link);
    return true;
  } catch {
    return false;
  }
}

// ---- card (sandbox only) ----

export interface CardDetails {
  number: string;
  holder: string;
  /** "03" */
  expiryMonth: string;
  /** "28" */
  expiryYear: string;
  cvv: string;
}

const GATEWAY_URLS = {
  sandbox: "https://sandbox.cashfree.com/pg",
  production: "https://api.cashfree.com/pg",
} as const;

/**
 * Starts a card payment and returns the gateway's 3-D Secure page to open.
 *
 * Sent from the device straight to the gateway, authorised by the order's
 * session id alone: the card never passes through GatePass's API, its logs or
 * its database. Never logged here either, and no error repeats what was typed.
 * Test mode only (owner's decision): production cards wait on PCI DSS.
 */
export async function startCardPayment(checkout: PaymentCheckout, apiVersion: string, card: CardDetails): Promise<string> {
  if (checkout.environment !== "sandbox") throw new UserError("Card payments aren't available yet. Pay with UPI.");

  let response: Response;
  try {
    response = await fetch(`${GATEWAY_URLS.sandbox}/orders/sessions`, {
      method: "POST",
      // Only headers the gateway allows from a browser (no x-client-*).
      headers: { "Content-Type": "application/json", "x-api-version": apiVersion },
      body: JSON.stringify({
        payment_session_id: checkout.paymentSessionId,
        payment_method: {
          card: {
            channel: "link",
            card_number: card.number,
            card_holder_name: card.holder,
            card_expiry_mm: card.expiryMonth,
            card_expiry_yy: card.expiryYear,
            card_cvv: card.cvv,
          },
        },
      }),
    });
  } catch {
    throw new UserError("Couldn't reach the payment partner. Check your connection and try again.");
  }

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new UserError(typeof data?.message === "string" ? `The card was refused: ${data.message}` : "The card was refused.");
  }

  const url = data?.data?.url;
  if (typeof url !== "string" || !isGatewayPage(url)) throw new UserError("The payment partner didn't send a page to continue on.");
  return url;
}

/**
 * Opens the gateway's page (card 3-D Secure). When it finishes, the gateway
 * sends the driver to the API's /payments/return, which forwards to this
 * booking's pay screen: gatepass:// in the app, the same tab on the web.
 *
 * Native waits in an auth session that closes on that link. In Expo Go the
 * scheme is exp://, so it doesn't close by itself -- the driver closes it and
 * lands on the pay screen, which finds out the result from the API anyway.
 */
export async function openPaymentPage(url: string, bookingId: string): Promise<void> {
  if (Platform.OS === "web") {
    window.location.assign(url);
    return;
  }
  await WebBrowser.openAuthSessionAsync(url, ExpoLinking.createURL(`booking/${bookingId}/pay`));
}

// ---- saved methods ----

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
 * live with the gateway (tokenised), not in GatePass's database. None are
 * saved yet: nothing asks the gateway to keep one.
 */
export async function listSavedMethods(_token: string): Promise<SavedPaymentMethod[]> {
  return [];
}
