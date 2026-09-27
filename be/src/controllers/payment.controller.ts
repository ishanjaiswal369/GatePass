import type { FastifyReply, FastifyRequest } from "fastify";
import type { PaymentReturnInput, StartUpiInput } from "../requests/payment.request.js";
import { securityEvent } from "../lib/security-log.js";
import * as paymentConfirmation from "../services/payment-confirmation.service.js";
import * as paymentService from "../services/payment.service.js";

export const paymentController = {
  list: async (request: FastifyRequest, reply: FastifyReply) => {
    return reply.send(await paymentService.listForDriver(request.user.userId));
  },

  options: async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.send(paymentService.paymentOptions());
  },

  startUpi: async (input: StartUpiInput, request: FastifyRequest, reply: FastifyReply) => {
    return reply.send(await paymentService.startUpi(input.params.id, request.user.userId, input.body));
  },

  /**
   * Cashfree's webhook. 200 for anything handled or ignored, so it isn't
   * sent again; 401 for a bad signature; a thrown error answers 5xx and
   * Cashfree retries.
   */
  cashfreeWebhook: async (request: FastifyRequest, reply: FastifyReply) => {
    const rawBody = (request as FastifyRequest & { rawBody?: string }).rawBody ?? "";
    const outcome = await paymentConfirmation.receiveWebhook(rawBody, request.headers);
    if (outcome === "BAD_SIGNATURE") {
      securityEvent(request, "WEBHOOK_SIGNATURE_INVALID", { provider: "cashfree" });
      return reply.code(401).send({ error: "Invalid signature" });
    }
    return reply.send({ ok: true });
  },

  paymentReturn: async (input: PaymentReturnInput, request: FastifyRequest, reply: FastifyReply) => {
    // 302 is the default: a redirect a browser follows and never caches.
    return reply.redirect(paymentService.returnTarget(input.query.order_id, request.headers["user-agent"]));
  },
};
