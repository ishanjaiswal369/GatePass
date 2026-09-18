import { authController } from "./controllers/auth.controller.js";
import { bookingController } from "./controllers/booking.controller.js";
import { capacityController } from "./controllers/capacity.controller.js";
import { healthController } from "./controllers/health.controller.js";
import { listingController } from "./controllers/listing.controller.js";
import { paymentController } from "./controllers/payment.controller.js";
import { settlementController } from "./controllers/settlement.controller.js";
import { userController } from "./controllers/user.controller.js";
import type { App } from "./lib/app.js";
import { request } from "./lib/request.js";
import { authenticate } from "./middleware/authenticate.js";
import { authRequests } from "./requests/auth.request.js";
import { bookingRequests } from "./requests/booking.request.js";
import { capacityRequests } from "./requests/capacity.request.js";
import { listingRequests } from "./requests/listing.request.js";
import { paymentRequests } from "./requests/payment.request.js";
import { settlementRequests } from "./requests/settlement.request.js";
import { userRequests } from "./requests/user.request.js";

export function registerApi(app: App): void {
  // Health
  app.get("/health", healthController.get);

  // Users
  app.get("/users", userController.list);
  app.post("/users", request(userRequests.create, userController.create));
  app.get("/users/:id", request(userRequests.getById, userController.getById));

  // Listings
  app.get(
    "/listings",
    { preHandler: [authenticate] },
    request(listingRequests.list, listingController.list)
  );
  app.post(
    "/listings",
    { preHandler: [authenticate] },
    request(listingRequests.create, listingController.create)
  );

  // Parking capacity
  app.get("/capacities", capacityController.list);
  app.post("/capacities", request(capacityRequests.create, capacityController.create));

  // Bookings
  app.get("/bookings", bookingController.list);
  app.post("/bookings", request(bookingRequests.create, bookingController.create));

  // Payments
  app.get("/payments", paymentController.list);
  app.post("/payments", request(paymentRequests.create, paymentController.create));

  // Settlements
  app.get("/settlements", settlementController.list);
  app.post(
    "/settlements",
    request(settlementRequests.create, settlementController.create)
  );
  app.get("/settlement-items", settlementController.listItems);
  app.post(
    "/settlement-items",
    request(settlementRequests.createItem, settlementController.createItem)
  );

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
  app.post("/auth/logout", { preHandler: [authenticate] }, authController.logout);
  app.get("/auth/sessions", { preHandler: [authenticate] }, authController.listSessions);
  app.delete(
    "/auth/sessions/:sessionId",
    { preHandler: [authenticate] },
    request(authRequests.removeSession, authController.removeSession)
  );
  app.get("/auth/me", { preHandler: [authenticate] }, authController.me);
  app.patch(
    "/auth/me",
    { preHandler: [authenticate] },
    request(authRequests.updateProfile, authController.updateMe)
  );
}
