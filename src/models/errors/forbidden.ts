import { MoopsyError } from "@moopsyjs/core";

export class ForbiddenError extends MoopsyError {
  public constructor() {
    super(403, "Forbidden");
  }
}