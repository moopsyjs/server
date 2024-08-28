import { MoopsyError } from "@moopsyjs/core";

export class TopicNotFoundError extends MoopsyError {
  public constructor(topicId: string) {
    super(404, "topic-not-found", `The topic "${topicId}" was not found`);
  }
}