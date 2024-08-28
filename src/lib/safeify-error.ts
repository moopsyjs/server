import { MoopsyError } from "@moopsyjs/core";
import { isMoopsyError } from "./is-moopsy-error";

export function safeifyError (e: Error): MoopsyError {
  if(isMoopsyError(e)) {
    return e;
  }

  return new MoopsyError(500, "internal-server-error", "Internal Server Error");
}