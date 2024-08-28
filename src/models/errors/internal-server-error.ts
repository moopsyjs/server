import { MoopsyError } from "@moopsyjs/core";

export class InternalServerError extends MoopsyError {
  public constructor() {
    super(500, "Internal Server Error");
  }
}