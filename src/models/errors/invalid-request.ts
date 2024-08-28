import { MoopsyError } from "@moopsyjs/core";

export class InvalidRequestError extends MoopsyError {
  public constructor() {
    super(400, "Invalid Request");
  }
}