import { MoopsyError } from "@moopsyjs/core";

export function safeJSONParse (input: string): any {
  try {
    return JSON.parse(input);
  } catch {
    throw new MoopsyError(400, "Invalid JSON");
  }
}