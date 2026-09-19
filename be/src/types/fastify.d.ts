import type { SessionPayload } from "../services/session.service.js";

declare module "fastify" {
  interface FastifyRequest {
    user: SessionPayload;
    /**
     * Set by requireHost. Present only on routes that ran it, which is why it
     * is optional here and non-null at every use site behind that middleware.
     */
    hostProfileId?: string;
    /** Set by requireOrganizerStaff: the organizers this user acts for. */
    organizerIds?: string[];
  }
}
