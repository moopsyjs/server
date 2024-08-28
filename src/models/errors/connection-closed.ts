import { MoopsyError } from "@moopsyjs/core";

export class ConnectionClosedError extends MoopsyError {
  public constructor() {
    super(410, "Connection already closed");
  }
}