import { RateLimitingConfigType } from "@moopsyjs/core";

export class RateLimiter {
  private readonly config: RateLimitingConfigType;
  private readonly calls: Array<number>;

  public constructor(config: RateLimitingConfigType) {
    this.config = config;
    this.calls = new Array(config.calls).fill(null);
  }

  public readonly call = (): boolean => {
    if(this.calls[0] === null || (Date.now() - this.calls[0]) >= this.config.per) {
      this.calls.shift();
      this.calls.push(Date.now());
      return true;
    }

    return false;
  };  
}