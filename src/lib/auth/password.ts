import { compare, hash } from "bcryptjs";

export const PASSWORD_COST = 12;
export function hashPassword(password: string) {
  if (Buffer.byteLength(password, "utf8") > 72) {
    throw new Error("Password exceeds bcrypt's 72-byte limit.");
  }
  return hash(password, PASSWORD_COST);
}

export async function verifyPassword(password: string, passwordHash: string) {
  if (Buffer.byteLength(password, "utf8") > 72) return false;
  return compare(password, passwordHash);
}
