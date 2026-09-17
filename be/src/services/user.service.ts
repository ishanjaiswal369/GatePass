import type { Role } from "../constants/enums/index.js";
import { prisma } from "../lib/prisma.js";

export interface CreateUserInput {
  email: string;
  name?: string;
  role?: Role;
  phone?: string;
}

export async function list() {
  return prisma.user.findMany();
}

export async function getById(id: string) {
  return prisma.user.findUnique({ where: { id } });
}

export async function create(input: CreateUserInput) {
  return prisma.user.create({ data: input });
}
