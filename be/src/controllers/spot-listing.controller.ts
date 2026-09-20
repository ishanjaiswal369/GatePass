import type { FastifyReply, FastifyRequest } from "fastify";
import type {
  CreateSpotInput,
  GetSpotInput,
  PresignInput,
  SaveAddressInput,
  SaveAvailabilityInput,
  SaveOwnershipDocInput,
  SavePhotosInput,
  SavePricingInput,
  SaveTermsInput,
  SubmitSpotInput,
} from "../requests/spot-listing.request.js";
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
  list: async (request: FastifyRequest, reply: FastifyReply) => {
    return reply.send({
      spots: await spotListingService.listForHost(hostProfileId(request)),
    });
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

  create: async (
    input: CreateSpotInput,
    request: FastifyRequest,
    reply: FastifyReply
  ) => {
    return reply
      .code(201)
      .send(
        await spotListingService.createDraft(
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
    return reply.send({
      availability: await spotListingService.replaceAvailability(
        input.params.id,
        hostProfileId(request),
        input.body.windows
      ),
    });
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
    const missing = await spotListingService.missingForSubmit(
      input.params.id,
      hostProfileId(request)
    );

    return reply.send({ ready: missing.length === 0, missing });
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
