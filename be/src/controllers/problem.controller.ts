import type { FastifyReply, FastifyRequest } from "fastify";
import type {
  AdminListProblemsInput,
  CreateProblemInput,
  GetProblemInput,
  PresignProblemPhotoInput,
  ResolveProblemInput,
} from "../requests/problem.request.js";
import * as problemService from "../services/problem.service.js";

export const problemController = {
  create: async (input: CreateProblemInput, request: FastifyRequest, reply: FastifyReply) => {
    return reply.code(201).send(await problemService.create(input.params.id, request.user.userId, input.body));
  },

  get: async (input: GetProblemInput, request: FastifyRequest, reply: FastifyReply) => {
    return reply.send(await problemService.getForDriver(input.params.id, request.user.userId));
  },

  presignPhoto: async (input: PresignProblemPhotoInput, request: FastifyRequest, reply: FastifyReply) => {
    return reply.send(await problemService.presignPhoto(input.params.id, request.user.userId, input.body));
  },

  adminList: async (input: AdminListProblemsInput, _request: FastifyRequest, reply: FastifyReply) => {
    return reply.send({ reports: await problemService.listForAdmin(input.query.status) });
  },

  resolve: async (input: ResolveProblemInput, request: FastifyRequest, reply: FastifyReply) => {
    return reply.send(await problemService.resolve(input.params.id, request.user.userId, input.body));
  },
};
