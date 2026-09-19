import type { FastifyReply, FastifyRequest } from "fastify";
import type {
  CreateVehicleInput,
  RemoveVehicleInput,
  UpdateVehicleInput,
} from "../requests/vehicle.request.js";
import * as vehicleService from "../services/vehicle.service.js";

export const vehicleController = {
  list: async (request: FastifyRequest, reply: FastifyReply) => {
    return reply.send({ vehicles: await vehicleService.list(request.user.userId) });
  },

  create: async (
    input: CreateVehicleInput,
    request: FastifyRequest,
    reply: FastifyReply
  ) => {
    return reply
      .code(201)
      .send(await vehicleService.create(request.user.userId, input.body));
  },

  update: async (
    input: UpdateVehicleInput,
    request: FastifyRequest,
    reply: FastifyReply
  ) => {
    return reply.send(
      await vehicleService.update(input.params.id, request.user.userId, input.body)
    );
  },

  remove: async (
    input: RemoveVehicleInput,
    request: FastifyRequest,
    reply: FastifyReply
  ) => {
    await vehicleService.remove(input.params.id, request.user.userId);
    return reply.code(204).send();
  },
};
