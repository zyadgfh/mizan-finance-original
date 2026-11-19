// File: zai/apps/api/src/users/users.service.ts
import type { PrismaClient } from "@prisma/client";
export class UsersService {
  constructor(private prisma: PrismaClient) {}
  findById(id: string) { return this.prisma.user.findUnique({ where: { id } }); }
}
