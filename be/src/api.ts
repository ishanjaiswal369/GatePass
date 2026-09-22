import { addressController } from "./controllers/address.controller.js";
import { adminSpotController } from "./controllers/admin-spot.controller.js";
import { authController } from "./controllers/auth.controller.js";
import { bookingController } from "./controllers/booking.controller.js";
import { capacityController } from "./controllers/capacity.controller.js";
import { eventController } from "./controllers/event.controller.js";
import { geocodeController } from "./controllers/geocode.controller.js";
import { healthController } from "./controllers/health.controller.js";
import { hostController } from "./controllers/host.controller.js";
import { hostPayoutController } from "./controllers/host-payout.controller.js";
import { listingController } from "./controllers/listing.controller.js";
import { paymentController } from "./controllers/payment.controller.js";
import { settlementController } from "./controllers/settlement.controller.js";
import { spotController } from "./controllers/spot.controller.js";
import { spotListingController } from "./controllers/spot-listing.controller.js";
import { uploadController } from "./controllers/upload.controller.js";
import { vehicleController } from "./controllers/vehicle.controller.js";
import type { App } from "./lib/app.js";
import { request } from "./lib/request.js";
import { authenticate } from "./middleware/authenticate.js";
import { requireAdmin } from "./middleware/require-admin.js";
import { requireHost } from "./middleware/require-host.js";
import { requireOrganizerStaff } from "./middleware/require-organizer-staff.js";
import { addressRequests } from "./requests/address.request.js";
import { adminSpotRequests } from "./requests/admin-spot.request.js";
import { authRequests } from "./requests/auth.request.js";
import { bookingRequests } from "./requests/booking.request.js";
import { capacityRequests } from "./requests/capacity.request.js";
import { eventRequests } from "./requests/event.request.js";
import { geocodeRequests } from "./requests/geocode.request.js";
import { hostRequests } from "./requests/host.request.js";
import { hostPayoutRequests } from "./requests/host-payout.request.js";
import { listingRequests } from "./requests/listing.request.js";
import { paymentRequests } from "./requests/payment.request.js";
import { settlementRequests } from "./requests/settlement.request.js";
import { spotRequests } from "./requests/spot.request.js";
import { spotListingRequests } from "./requests/spot-listing.request.js";
import { vehicleRequests } from "./requests/vehicle.request.js";

/**
 * Route registration, grouped by who is allowed to call it.
 *
 * Every route below `/health` and `/auth/*` runs `authenticate`. Driver routes
 * stop there -- any signed-in user is a driver -- while host and organizer
 * routes add a database-backed check on top. There is no "open" group.
 */
export function registerApi(app: App): void {
  const driver = { preHandler: [authenticate] };
  const host = { preHandler: [authenticate, requireHost] };
  const organizer = { preHandler: [authenticate, requireOrganizerStaff] };
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

  // Driver discovery -- the Events tab of the home screen.
  app.get("/events", driver, request(eventRequests.list, eventController.list));
  app.get(
    "/events/:id",
    driver,
    request(eventRequests.getById, eventController.getById)
  );

  // Driver discovery -- the Nearby tab.
  app.get(
    "/spots/nearby",
    driver,
    request(spotRequests.nearby, spotController.nearby)
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
  app.get(
    "/bookings/:id/pass",
    driver,
    request(bookingRequests.pass, bookingController.pass)
  );
  app.post(
    "/bookings",
    driver,
    request(bookingRequests.create, bookingController.create)
  );

  // Driver payments, against the driver's own bookings.
  app.get("/payments", driver, paymentController.list);
  app.post(
    "/payments",
    driver,
    request(paymentRequests.create, paymentController.create)
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
  app.get("/host/settlements", host, settlementController.listForHost);

  // Host spot wizard. A host can list more than one spot; every step writes
  // to a specific listing id, so a host who drops out halfway keeps what they
  // already entered on that spot, and starting another does not touch it.
  app.get("/host/spots", host, spotListingController.list);
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

  // Host payout account -- the second gate on going live.
  app.get("/host/payout-account", host, hostPayoutController.getStatus);
  app.post(
    "/host/payout-account",
    host,
    request(hostPayoutRequests.submit, hostPayoutController.submit)
  );

  // Organizer
  app.get("/listings", organizer, listingController.list);
  app.post(
    "/listings",
    organizer,
    request(listingRequests.create, listingController.create)
  );
  app.get(
    "/capacities",
    organizer,
    request(capacityRequests.list, capacityController.list)
  );
  app.post(
    "/capacities",
    organizer,
    request(capacityRequests.create, capacityController.create)
  );
  app.get("/settlements", organizer, settlementController.list);

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
  app.post(
    "/admin/host-payout-status",
    admin,
    request(adminSpotRequests.setPayoutStatus, adminSpotController.setPayoutStatus)
  );

  // Admin. Settlements are written by the payout engine, which does not exist
  // yet; until it does, only an admin can create one by hand.
  app.post(
    "/settlements",
    admin,
    request(settlementRequests.create, settlementController.create)
  );
  app.get(
    "/settlement-items",
    admin,
    request(settlementRequests.listItems, settlementController.listItems)
  );
  app.post(
    "/settlement-items",
    admin,
    request(settlementRequests.createItem, settlementController.createItem)
  );
}
