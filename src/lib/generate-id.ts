import crypto from "crypto";

export function generateId (length: number): string {
  return crypto.randomBytes(length).toString("hex");
}