import * as crypto from "crypto";
import type { MoopsyStream } from "@moopsyjs/core";

/**
 * Beta feature, returns a stream that can be written to even after the initial method has returned.
 * 
 * Rules when using WriteableMoopsyStreams:
 * - WriteableMoopsyStreams must be top level properties of the response object.
 * - WriteableMoopsyStreams returned as part of side effect responses will be ignored
 */
export class WriteableMoopsyStream<T> implements MoopsyStream<T> {
  public readonly __moopsyStream = true;
  public readonly id: string = crypto.randomBytes(16).toString("hex");
  private readonly backlog: T[] = [];
  private ended: boolean = false;
  private readonly listeners: (() => void)[] = [];
  private readonly timeout: NodeJS.Timeout;

  public constructor(options?: { timeout?: number; }) {
    const timeoutDuration: number = options?.timeout ?? 60_000;

    this.timeout = setTimeout(() => {
      console.warn("WriteableMoopsyStream timed out, ending stream", Error().stack);
      this.end();
    }, timeoutDuration);
  }

  private readonly changed = (): void => {
    for (const listener of this.listeners) {
      listener();
    }
  };
  
  public readonly write = (data: T): void => {
    if (this.ended) {
      throw new Error("Cannot write to a WriteableMoopsyStream that has ended.");
    }

    this.backlog.push(data);
    this.changed();
  };
  
  public readonly end = (): void => {
    clearTimeout(this.timeout);

    // Fire a final change event to ensure that any remaining data is sent
    this.changed();
    
    this.ended = true;

    // Purge listeners
    this.listeners.splice(0);
    
    // Purge backlog
    this.backlog.splice(0);
  };
  
  public readonly read = (): {
    backlog: T[],
    ended: boolean
  } => {
    return {
      backlog: this.backlog.splice(0),
      ended: this.ended
    };
  };
  
  public readonly onChange = (fn: () => void): void => {
    this.listeners.push(fn);
  };
  
  public toJSON(): object {
    return { __moopsyStream: this.id };
  }
}