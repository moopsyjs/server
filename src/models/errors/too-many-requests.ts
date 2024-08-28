import { MoopsyError } from "@moopsyjs/core";

export class TooManyRequestsError extends MoopsyError {
  public constructor() {
    super(429, "Too Many Requests");
  }
}