import { MoopsyError } from "@moopsyjs/core";

export class NotAuthenticatedError extends MoopsyError {
  public constructor() {
    super(403, "not-authenticated", "You must be logged in to do this");
  }
}