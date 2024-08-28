import { MoopsyError } from "@moopsyjs/core";

export class UnsupportedError extends MoopsyError {
  public constructor() {
    super(405, "unsupported", "This action is not supported by the server");
  }
}