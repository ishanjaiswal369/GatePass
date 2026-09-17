import type { User } from "@prisma/client";
import type { Role } from "../constants/enums/index.js";
import { prisma } from "../lib/prisma.js";

export interface CreateUserInput {
  email: string;
  firstName?: string;
  lastName?: string;
  role?: Role;
  phone?: string;
}

export interface UpdateProfileInput {
  firstName?: string;
  lastName?: string | null;
}

/**
 * The user shape returned by the auth endpoints. Keeps /auth/me and
 * verify-code in agreement, and keeps internal columns out of responses.
 */
export function toAuthUser(user: User) {
  return {
    id: user.id,
    email: user.email,
    phone: user.phone,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
  };
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

export async function updateProfile(id: string, input: UpdateProfileInput) {
  return prisma.user.update({ where: { id }, data: input });
}
