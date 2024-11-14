import * as crypto from "crypto";

/**
 * Beta feature, returns a stream that can be written to even after the initial method has returned.
 * 
 * Rules when using WriteableMoopsyStreams:
 * - WriteableMoopsyStreams must be top level properties of the response object.
 * - WriteableMoopsyStreams returned as part of side effect responses will be ignored
 */
export class WriteableMoopsyStream<T> {
  public readonly id: string = crypto.randomBytes(16).toString("hex");
  private readonly backlog: T[] = [];
  private ended: boolean = false;
  private readonly listeners: (() => void)[] = [];

  private readonly changed = (): void => {
    for (const listener of this.listeners) {
      listener();
    }
  };
  
  public readonly onData = (data: T): void => {
    if (this.ended) {
      throw new Error("Cannot write to a WriteableMoopsyStream that has ended.");
    }

    this.backlog.push(data);
    this.changed();
  };
  
  public readonly onEnd = (): void => {
    this.ended = true;
    this.changed();
    this.listeners.splice(0);
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