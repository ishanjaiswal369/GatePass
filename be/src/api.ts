import { addressController } from "./controllers/address.controller.js";
import { adminSpotController } from "./controllers/admin-spot.controller.js";
import { authController } from "./controllers/auth.controller.js";
import { bookingController } from "./controllers/booking.controller.js";
import { geocodeController } from "./controllers/geocode.controller.js";
import { healthController } from "./controllers/health.controller.js";
import { hostController } from "./controllers/host.controller.js";
import { hostOperationsController } from "./controllers/host-operations.controller.js";
import { hostPayoutController } from "./controllers/host-payout.controller.js";
import { notificationController } from "./controllers/notification.controller.js";
import { paymentController } from "./controllers/payment.controller.js";
import { refundController } from "./controllers/refund.controller.js";
import { problemController } from "./controllers/problem.controller.js";
import { reviewController } from "./controllers/review.controller.js";
import { settingsController } from "./controllers/settings.controller.js";
import { spotController } from "./controllers/spot.controller.js";
import { spotListingController } from "./controllers/spot-listing.controller.js";
import { uploadController } from "./controllers/upload.controller.js";
import { vehicleController } from "./controllers/vehicle.controller.js";
import type { App } from "./lib/app.js";
import { request } from "./lib/request.js";
import { authenticate } from "./middleware/authenticate.js";
import { requireAdmin } from "./middleware/require-admin.js";
import { requireHost } from "./middleware/require-host.js";
import { addressRequests } from "./requests/address.request.js";
import { adminSpotRequests } from "./requests/admin-spot.request.js";
import { authRequests } from "./requests/auth.request.js";
import { bookingRequests } from "./requests/booking.request.js";
import { geocodeRequests } from "./requests/geocode.request.js";
import { paymentRequests } from "./requests/payment.request.js";
import { hostRequests } from "./requests/host.request.js";
import { hostOperationsRequests } from "./requests/host-operations.request.js";
import { hostPayoutRequests } from "./requests/host-payout.request.js";
import { notificationRequests } from "./requests/notification.request.js";
import { problemRequests } from "./requests/problem.request.js";
import { refundRequests } from "./requests/refund.request.js";
import { reviewRequests } from "./requests/review.request.js";
import { settingsRequests } from "./requests/settings.request.js";
import { spotRequests } from "./requests/spot.request.js";
import { spotListingRequests } from "./requests/spot-listing.request.js";
import { vehicleRequests } from "./requests/vehicle.request.js";

/**
 * Route registration, grouped by who is allowed to call it.
 *
 * Every route below `/health` and `/auth/*` runs `authenticate`. Driver routes
 * stop there -- any signed-in user is a driver -- while host and admin
 * routes add a database-backed check on top. There is no "open" group.
 */
export function registerApi(app: App): void {
  const driver = { preHandler: [authenticate] };
  const host = { preHandler: [authenticate, requireHost] };
  const admin = { preHandler: [authenticate, requireAdmin] };

  // Health
  app.get("/health", healthController.get);

  // Local object storage (STORAGE_PROVIDER=local only). Unauthenticated by
  // design: the signed, expiring URL is the credential, the same way it is
  // with a presigned S3 URL.
  app.put("/uploads/*", uploadController.put);
  app.get("/uploads/*", uploadController.get);

  // Auth
  app.post(
    "/auth/request-code",
    request(authRequests.requestCode, authController.requestCode)
  );
  app.post(
    "/auth/verify-code",
    request(authRequests.verifyCode, authController.verifyCode)
  );
  app.post(
    "/auth/google",
    request(authRequests.googleSignIn, authController.googleSignIn)
  );
  // Password. Setting one is always gated on an emailed code, so the same two
  // endpoints serve "set a password" from the profile and "forgot password"
  // from the sign-in screen -- both are unauthenticated for that reason.
  app.post(
    "/auth/password/request-code",
    request(authRequests.requestPasswordCode, authController.requestPasswordCode)
  );
  app.post(
    "/auth/password/set",
    request(authRequests.setPassword, authController.setPassword)
  );
  app.post("/auth/login", request(authRequests.login, authController.login));
  // Changing a known password needs no emailed code: proving the current one
  // is the check. Signed-in only, and it keeps the caller's own session.
  app.post(
    "/auth/password/change",
    driver,
    request(authRequests.changePassword, authController.changePassword)
  );

  app.post("/auth/logout", driver, authController.logout);
  app.get("/auth/sessions", driver, authController.listSessions);
  app.delete(
    "/auth/sessions/:sessionId",
    driver,
    request(authRequests.removeSession, authController.removeSession)
  );
  app.get("/auth/me", driver, authController.me);
  // Account deletion is soft and needs an emailed code, so a stolen session
  // alone cannot remove an account.
  app.get("/auth/account/deletion", driver, authController.deletionStatus);
  app.post(
    "/auth/account/delete/request-code",
    driver,
    request(authRequests.requestDeletionCode, authController.requestDeletionCode)
  );
  app.post(
    "/auth/account/delete",
    driver,
    request(authRequests.deleteAccount, authController.deleteAccount)
  );
  app.patch(
    "/auth/me",
    driver,
    request(authRequests.updateProfile, authController.updateMe)
  );

  // Inbox. Always the caller's own: userId comes from the token.
  app.get(
    "/notifications",
    driver,
    request(notificationRequests.list, notificationController.list)
  );
  app.get("/notifications/unread-count", driver, notificationController.unreadCount);
  app.post(
    "/notifications/read",
    driver,
    request(notificationRequests.read, notificationController.read)
  );
  // This device's FCM token, kept on the caller's session. Signing out deletes
  // the session, and the token with it.
  app.put(
    "/notifications/push-token",
    driver,
    request(notificationRequests.pushToken, notificationController.savePushToken)
  );
  app.delete("/notifications/push-token", driver, notificationController.clearPushToken);

  // Settings (UserSettings). The caller's own; PATCH changes only what it names.
  app.get("/settings", driver, settingsController.get);
  app.patch("/settings", driver, request(settingsRequests.update, settingsController.update));

  // Profile
  app.get("/vehicles", driver, vehicleController.list);
  app.post(
    "/vehicles",
    driver,
    request(vehicleRequests.create, vehicleController.create)
  );
  app.patch(
    "/vehicles/:id",
    driver,
    request(vehicleRequests.update, vehicleController.update)
  );
  app.delete(
    "/vehicles/:id",
    driver,
    request(vehicleRequests.remove, vehicleController.remove)
  );
  app.get("/address", driver, addressController.get);
  app.put(
    "/address",
    driver,
    request(addressRequests.save, addressController.save)
  );

  // Driver discovery -- the Nearby tab.
  app.get(
    "/spots/nearby",
    driver,
    request(spotRequests.nearby, spotController.nearby)
  );
  // Registered after /spots/nearby so the literal path is not swallowed by
  // the parameter. This is a spot's only read for drivers.
  app.get(
    "/spots/:id",
    driver,
    request(spotRequests.getById, spotController.getById)
  );
  // The checkout's price, from the same function the booking charges with.
  app.get(
    "/spots/:id/quote",
    driver,
    request(spotRequests.quote, spotController.quote)
  );
  // What drivers who parked there thought. Read behind the same gate as the
  // spot; written only through a booking, below.
  app.get(
    "/spots/:id/reviews",
    driver,
    request(reviewRequests.listForSpot, reviewController.listForSpot)
  );
  // Saved spots. PUT/DELETE rather than POST so both are idempotent: a heart
  // is the control people tap twice.
  app.get("/favorites", driver, spotController.favorites);
  app.put(
    "/favorites/:id",
    driver,
    request(spotRequests.favorite, spotController.save)
  );
  app.delete(
    "/favorites/:id",
    driver,
    request(spotRequests.favorite, spotController.unsave)
  );
  app.get(
    "/geocode",
    driver,
    request(geocodeRequests.search, geocodeController.search)
  );
  // Type-ahead. Separate from /geocode because it answers with suggestions
  // that may carry no coordinates, which /geocode always does.
  app.get(
    "/geocode/autocomplete",
    driver,
    request(geocodeRequests.autocomplete, geocodeController.autocomplete)
  );
  app.get(
    "/geocode/place/:placeId",
    driver,
    request(geocodeRequests.place, geocodeController.place)
  );
  // The other direction: what is at this point. Used by the pin screen, which
  // has coordinates and owes the host a readable address.
  app.get(
    "/geocode/reverse",
    driver,
    request(geocodeRequests.reverse, geocodeController.reverse)
  );
  // Proxied rather than linked: the upstream URL carries the API key.
  app.get(
    "/geocode/static-map",
    driver,
    request(geocodeRequests.staticMap, geocodeController.staticMap)
  );

  // Driver bookings. `/bookings/active` is declared before `/bookings/:id` so
  // "active" is never parsed as an id.
  app.get(
    "/bookings",
    driver,
    request(bookingRequests.list, bookingController.list)
  );
  app.get("/bookings/active", driver, bookingController.active);
  app.get(
    "/bookings/:id",
    driver,
    request(bookingRequests.getById, bookingController.getById)
  );
  // Cancelling: the quote first, so the driver sees the refund before
  // committing; the POST applies the same policy to the same row.
  app.get(
    "/bookings/:id/cancellation",
    driver,
    request(bookingRequests.cancellation, bookingController.cancellation)
  );
  app.post(
    "/bookings/:id/cancel",
    driver,
    request(bookingRequests.cancel, bookingController.cancel)
  );
  // Extra time on a stay that is running: sold as a hold of its own, see
  // booking-extension.service.
  app.get(
    "/bookings/:id/extensions",
    driver,
    request(bookingRequests.extensionOptions, bookingController.extensionOptions)
  );
  app.post(
    "/bookings/:id/extensions",
    driver,
    request(bookingRequests.createExtension, bookingController.createExtension)
  );
  // "I can't use this parking": one report per booking, see problem.service.
  // The photo URL comes from the presign route below and nowhere else.
  app.post(
    "/bookings/:id/problem",
    driver,
    request(problemRequests.create, problemController.create)
  );
  app.get(
    "/bookings/:id/problem",
    driver,
    request(problemRequests.get, problemController.get)
  );
  app.post(
    "/bookings/:id/problem/photo-upload-url",
    driver,
    request(problemRequests.presignPhoto, problemController.presignPhoto)
  );
  // Rating the spot after a paid stay: one per booking, see review.service.
  app.post(
    "/bookings/:id/review",
    driver,
    request(reviewRequests.create, reviewController.create)
  );
  // A spot is booked by the stretch of time -- see booking.service.createSpotBooking.
  app.post(
    "/spot-bookings",
    driver,
    request(bookingRequests.createSpot, bookingController.createSpot)
  );

  // The driver's own payments. There is no POST: a payment row is opened with
  // its booking (POST /spot-bookings), never on the app's say-so.
  app.get("/payments", driver, paymentController.list);
  app.get("/payments/options", driver, paymentController.options);
  // A UPI attempt on the booking's order: app links or a QR. Card never comes
  // through here -- the app sends it straight to the gateway (sandbox only).
  app.post(
    "/bookings/:id/pay/upi",
    driver,
    request(paymentRequests.startUpi, paymentController.startUpi)
  );
  // Public: Cashfree's payment webhooks (each order's notify_url). Checked by
  // signature, not a token. Registered in a scope of its own so its JSON
  // parser can keep the raw body -- the signature is over the exact bytes
  // sent -- without changing how any other route parses.
  app.register(async (scope) => {
    scope.removeContentTypeParser("application/json");
    scope.addContentTypeParser("application/json", { parseAs: "string" }, (request, body, done) => {
      (request as typeof request & { rawBody?: string }).rawBody = body as string;
      try {
        done(null, JSON.parse(body as string));
      } catch {
        // Unparseable: left for the signature check to refuse.
        done(null, {});
      }
    });
    scope.post("/webhooks/cashfree", paymentController.cashfreeWebhook);
  });
  // Public: the gateway's payment page sends the driver here, with no token.
  // It only redirects to the booking's pay screen; see payment.service.
  app.get(
    "/payments/return",
    request(paymentRequests.paymentReturn, paymentController.paymentReturn)
  );

  // Host
  //
  // There is no POST /host/profile any more. Becoming a host was its own
  // step, which asked for an address and opened an unnamed listing before the
  // host had said what they were listing; POST /host/spots does both now, at
  // the point the spot gets a name.
  app.get("/host/profile", driver, hostController.getProfile);
  app.get(
    "/host/availability",
    host,
    request(hostRequests.listAvailability, hostController.listAvailability)
  );
  app.post(
    "/host/availability",
    host,
    request(hostRequests.addAvailability, hostController.addAvailability)
  );
  app.patch(
    "/host/availability/:id",
    host,
    request(hostRequests.updateAvailability, hostController.updateAvailability)
  );
  app.delete(
    "/host/availability/:id",
    host,
    request(hostRequests.removeAvailability, hostController.removeAvailability)
  );

  // Host spot wizard. A host can list more than one spot; every step writes
  // to a specific listing id, so a host who drops out halfway keeps what they
  // already entered on that spot, and starting another does not touch it.
  app.get("/host/spots", host, spotListingController.list);
  // Running a space day to day (Phase 5): every one scoped to the caller's
  // host profile in the service's WHERE, so another host's id is a 404.
  app.get("/host/summary", host, hostOperationsController.summary);
  app.get("/host/earnings", host, hostOperationsController.earnings);
  app.get(
    "/host/bookings",
    host,
    request(hostOperationsRequests.bookings, hostOperationsController.bookings)
  );
  app.get(
    "/host/spots/:id/overview",
    host,
    request(hostOperationsRequests.overview, hostOperationsController.overview)
  );
  app.patch(
    "/host/spots/:id/pause",
    host,
    request(hostOperationsRequests.pause, hostOperationsController.pause)
  );
  app.get(
    "/host/spots/:id/calendar",
    host,
    request(hostOperationsRequests.calendar, hostOperationsController.calendar)
  );
  app.post(
    "/host/spots/:id/blocks",
    host,
    request(hostOperationsRequests.createBlock, hostOperationsController.createBlock)
  );
  app.delete(
    "/host/spots/:id/blocks/:blockId",
    host,
    request(hostOperationsRequests.removeBlock, hostOperationsController.removeBlock)
  );
  // `driver`, not `host`: this is the request that makes someone a host, so
  // requiring a host profile would lock every new one out.
  app.post(
    "/host/spots",
    driver,
    request(spotListingRequests.create, spotListingController.create)
  );
  app.delete(
    "/host/spots/:id",
    host,
    request(spotListingRequests.delete, spotListingController.delete)
  );
  app.get(
    "/host/spots/:id",
    host,
    request(spotListingRequests.getById, spotListingController.getById)
  );
  app.patch(
    "/host/spots/:id/type",
    host,
    request(spotListingRequests.saveType, spotListingController.saveType)
  );
  app.patch(
    "/host/spots/:id/address",
    host,
    request(spotListingRequests.saveAddress, spotListingController.saveAddress)
  );
  app.post(
    "/host/spots/:id/photo-upload-url",
    host,
    request(spotListingRequests.presignPhoto, spotListingController.presignPhoto)
  );
  app.patch(
    "/host/spots/:id/photos",
    host,
    request(spotListingRequests.savePhotos, spotListingController.savePhotos)
  );
  app.post(
    "/host/spots/:id/document-upload-url",
    host,
    request(spotListingRequests.presignDoc, spotListingController.presignOwnershipDoc)
  );
  app.patch(
    "/host/spots/:id/ownership-document",
    host,
    request(
      spotListingRequests.saveOwnershipDoc,
      spotListingController.saveOwnershipDoc
    )
  );
  app.patch(
    "/host/spots/:id/terms",
    host,
    request(spotListingRequests.saveTerms, spotListingController.saveTerms)
  );
  app.put(
    "/host/spots/:id/availability",
    host,
    request(
      spotListingRequests.saveAvailability,
      spotListingController.saveAvailability
    )
  );
  app.patch(
    "/host/spots/:id/features",
    host,
    request(spotListingRequests.saveFeatures, spotListingController.saveFeatures)
  );
  app.patch(
    "/host/spots/:id/limits",
    host,
    request(spotListingRequests.saveLimits, spotListingController.saveLimits)
  );
  app.patch(
    "/host/spots/:id/details",
    host,
    request(spotListingRequests.saveDetails, spotListingController.saveDetails)
  );
  app.patch(
    "/host/spots/:id/booking-rules",
    host,
    request(spotListingRequests.saveBookingRules, spotListingController.saveBookingRules)
  );
  app.patch(
    "/host/spots/:id/permission",
    host,
    request(spotListingRequests.savePermission, spotListingController.savePermission)
  );
  app.get(
    "/host/spots/:id/ownership-document",
    host,
    request(spotListingRequests.ownershipDocument, spotListingController.ownershipDocument)
  );
  app.patch(
    "/host/spots/:id/pricing",
    host,
    request(spotListingRequests.savePricing, spotListingController.savePricing)
  );
  app.get(
    "/host/spots/:id/readiness",
    host,
    request(spotListingRequests.submit, spotListingController.readiness)
  );
  app.post(
    "/host/spots/:id/submit",
    host,
    request(spotListingRequests.submit, spotListingController.submit)
  );

  // Payout account -- the second gate on going live. Signed-in users, not
  // only hosts: the Payouts tab is open before anything is listed, and
  // submitting creates the host profile the payee belongs to.
  app.get("/host/payout-account", driver, hostPayoutController.getStatus);
  app.post(
    "/host/payout-account",
    driver,
    request(hostPayoutRequests.submit, hostPayoutController.submit)
  );

  // Admin: host spot review. Approving clears the ownership document only --
  // publication also waits on the host's payout account, so approve() reports
  // which gate is still outstanding rather than pretending the spot is live.
  app.get(
    "/admin/spots",
    admin,
    request(adminSpotRequests.list, adminSpotController.list)
  );
  app.get(
    "/admin/spots/:id",
    admin,
    request(adminSpotRequests.getById, adminSpotController.getById)
  );
  app.post(
    "/admin/spots/:id/approve",
    admin,
    request(adminSpotRequests.approve, adminSpotController.approve)
  );
  app.get(
    "/admin/spots/:id/ownership-document",
    admin,
    request(adminSpotRequests.ownershipDocument, adminSpotController.ownershipDocument)
  );
  app.post(
    "/admin/spots/:id/reject",
    admin,
    request(adminSpotRequests.reject, adminSpotController.reject)
  );
  app.post(
    "/admin/spots/:id/suspend",
    admin,
    request(adminSpotRequests.suspend, adminSpotController.suspend)
  );
  // Support's queue of problem reports, and the decision on one.
  app.get(
    "/admin/problems",
    admin,
    request(problemRequests.adminList, problemController.adminList)
  );
  app.post(
    "/admin/problems/:id/resolve",
    admin,
    request(problemRequests.resolve, problemController.resolve)
  );
  // Refunds at the gateway: the list (with the ids to reconcile against the
  // gateway's dashboard) and a retry of a failed one, at most 3 attempts.
  app.get(
    "/admin/refunds",
    admin,
    request(refundRequests.adminList, refundController.adminList)
  );
  app.post(
    "/admin/refunds/:id/retry",
    admin,
    request(refundRequests.retry, refundController.retry)
  );
  app.post(
    "/admin/host-payout-status",
    admin,
    request(adminSpotRequests.setPayoutStatus, adminSpotController.setPayoutStatus)
  );
}
