import { prisma } from "../lib/prisma.js";

export interface CreateUserInput {
  phone: string;
  name?: string;
  role?: "DRIVER" | "ORGANIZER" | "ADMIN";
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
