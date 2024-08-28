import { MoopsyError } from "@moopsyjs/core";

export function isMoopsyError (data:any): data is MoopsyError {
  return "error" in data;
}