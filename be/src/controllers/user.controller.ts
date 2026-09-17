import type { FastifyReply, FastifyRequest } from "fastify";
import type { CreateUserInput, GetUserByIdInput } from "../requests/user.request.js";
import * as userService from "../services/user.service.js";

export const userController = {
  list: async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.send(await userService.list());
  },

  getById: async (
    input: GetUserByIdInput,
    _request: FastifyRequest,
    reply: FastifyReply
  ) => {
    return reply.send(await userService.getById(input.params.id));
  },

  create: async (
    input: CreateUserInput,
    _request: FastifyRequest,
    reply: FastifyReply
  ) => {
    return reply.code(201).send(await userService.create(input.body));
  },
};
