import type { FastifyReply, FastifyRequest } from "fastify";
import type {
  CreateSpotInput,
  DeleteSpotInput,
  GetSpotInput,
  PresignInput,
  SaveAddressInput,
  SaveAvailabilityInput,
  SaveOwnershipDocInput,
  SavePhotosInput,
  SavePricingInput,
  SaveTermsInput,
  SaveTypeInput,
  SubmitSpotInput,
  SaveFeaturesInput,
  SaveLimitsInput,
  SaveDetailsInput,
  SaveBookingRulesInput,
  SavePermissionInput,
  OwnershipDocumentInput,
} from "../requests/spot-listing.request.js";
import { sendFile } from "../lib/send-file.js";
import { audit } from "../lib/security-log.js";
import * as hostPayoutService from "../services/host-payout.service.js";
import * as spotListingService from "../services/spot-listing.service.js";

/**
 * Routes behind requireHost always have hostProfileId set. The middleware
 * answers 403 before the handler runs, so this only narrows the type.
 */
function hostProfileId(request: FastifyRequest): string {
  if (!request.hostProfileId) {
    throw new Error("requireHost must run before this handler");
  }

  return request.hostProfileId;
}

export const spotListingController = {
  /**
   * The host dashboard, in one call. Payout status rides along because it is
   * the second of the two gates on going live: a host looking at a submitted
   * spot that is not yet live is owed the reason, and half the time the
   * reason is here rather than on the listing.
   */
  list: async (request: FastifyRequest, reply: FastifyReply) => {
    const id = hostProfileId(request);

    const [spots, payout] = await Promise.all([
      spotListingService.listForHost(id),
      hostPayoutService.getStatus(id),
    ]);

    return reply.send({ spots, payout });
  },

  getById: async (
    input: GetSpotInput,
    request: FastifyRequest,
    reply: FastifyReply
  ) => {
    return reply.send(
      await spotListingService.getForHost(input.params.id, hostProfileId(request))
    );
  },

  /**
   * Not gated on being a host: this is the request that makes someone one.
   * Every other route here is behind requireHost, which reads the profile
   * this one creates.
   */
  create: async (
    input: CreateSpotInput,
    request: FastifyRequest,
    reply: FastifyReply
  ) => {
    return reply
      .code(201)
      .send(
        await spotListingService.createSpot(request.user.userId, input.body)
      );
  },

  delete: async (
    input: DeleteSpotInput,
    request: FastifyRequest,
    reply: FastifyReply
  ) => {
    await spotListingService.deleteListing(
      input.params.id,
      hostProfileId(request),
      request.user.userId
    );
    return reply.code(204).send();
  },

  saveType: async (
    input: SaveTypeInput,
    request: FastifyRequest,
    reply: FastifyReply
  ) => {
    return reply.send(
      await spotListingService.saveType(
        input.params.id,
        hostProfileId(request),
        request.user.userId,
        input.body
      )
    );
  },

  saveAddress: async (
    input: SaveAddressInput,
    request: FastifyRequest,
    reply: FastifyReply
  ) => {
    return reply.send(
      await spotListingService.saveAddress(
        input.params.id,
        hostProfileId(request),
        request.user.userId,
        input.body
      )
    );
  },

  presignPhoto: async (
    input: PresignInput,
    request: FastifyRequest,
    reply: FastifyReply
  ) => {
    return reply.send(
      await spotListingService.presignUpload(
        input.params.id,
        hostProfileId(request),
        "photo",
        input.body
      )
    );
  },

  presignOwnershipDoc: async (
    input: PresignInput,
    request: FastifyRequest,
    reply: FastifyReply
  ) => {
    return reply.send(
      await spotListingService.presignUpload(
        input.params.id,
        hostProfileId(request),
        "ownership-doc",
        input.body
      )
    );
  },

  savePhotos: async (
    input: SavePhotosInput,
    request: FastifyRequest,
    reply: FastifyReply
  ) => {
    return reply.send(
      await spotListingService.replacePhotos(
        input.params.id,
        hostProfileId(request),
        input.body.urls
      )
    );
  },

  saveOwnershipDoc: async (
    input: SaveOwnershipDocInput,
    request: FastifyRequest,
    reply: FastifyReply
  ) => {
    return reply.send(
      await spotListingService.saveOwnershipDoc(
        input.params.id,
        hostProfileId(request),
        request.user.userId,
        input.body.url
      )
    );
  },

  saveTerms: async (
    input: SaveTermsInput,
    request: FastifyRequest,
    reply: FastifyReply
  ) => {
    return reply.send(
      await spotListingService.saveTerms(
        input.params.id,
        hostProfileId(request),
        request.user.userId,
        input.body
      )
    );
  },

  saveAvailability: async (
    input: SaveAvailabilityInput,
    request: FastifyRequest,
    reply: FastifyReply
  ) => {
    return reply.send(
      await spotListingService.replaceAvailability(
        input.params.id,
        hostProfileId(request),
        input.body.windows
      )
    );
  },

  saveFeatures: async (input: SaveFeaturesInput, request: FastifyRequest, reply: FastifyReply) => {
    return reply.send(
      await spotListingService.saveFeatures(input.params.id, hostProfileId(request), request.user.userId, input.body.amenities)
    );
  },

  saveLimits: async (input: SaveLimitsInput, request: FastifyRequest, reply: FastifyReply) => {
    return reply.send(
      await spotListingService.saveLimits(input.params.id, hostProfileId(request), request.user.userId, input.body)
    );
  },

  saveDetails: async (input: SaveDetailsInput, request: FastifyRequest, reply: FastifyReply) => {
    return reply.send(
      await spotListingService.saveDetails(input.params.id, hostProfileId(request), request.user.userId, input.body)
    );
  },

  saveBookingRules: async (input: SaveBookingRulesInput, request: FastifyRequest, reply: FastifyReply) => {
    return reply.send(
      await spotListingService.saveBookingRules(input.params.id, hostProfileId(request), request.user.userId, input.body)
    );
  },

  savePermission: async (input: SavePermissionInput, request: FastifyRequest, reply: FastifyReply) => {
    return reply.send(
      await spotListingService.savePermission(input.params.id, hostProfileId(request), request.user.userId, input.body)
    );
  },

  /** The host's own ownership document. Its public URL is closed (storage PRIVATE_PREFIXES). */
  ownershipDocument: async (input: OwnershipDocumentInput, request: FastifyRequest, reply: FastifyReply) => {
    const file = await spotListingService.ownershipDocumentFile(input.params.id, hostProfileId(request));
    audit("OWNERSHIP_DOC_VIEWED", { userId: request.user.userId, listingId: input.params.id, as: "host" });
    return sendFile(reply, file);
  },

  savePricing: async (
    input: SavePricingInput,
    request: FastifyRequest,
    reply: FastifyReply
  ) => {
    return reply.send(
      await spotListingService.replacePricing(
        input.params.id,
        hostProfileId(request),
        input.body.rates
      )
    );
  },

  /**
   * What the review step renders. Separate from submit so the wizard can show
   * the host what is missing without attempting a submission that fails.
   */
  readiness: async (
    input: SubmitSpotInput,
    request: FastifyRequest,
    reply: FastifyReply
  ) => {
    const items = await spotListingService.readiness(input.params.id, hostProfileId(request));

    return reply.send({ ready: items.length === 0, missing: items.map((item) => item.message), items });
  },

  submit: async (
    input: SubmitSpotInput,
    request: FastifyRequest,
    reply: FastifyReply
  ) => {
    return reply.send(
      await spotListingService.submit(
        input.params.id,
        hostProfileId(request),
        request.user.userId
      )
    );
  },
};
