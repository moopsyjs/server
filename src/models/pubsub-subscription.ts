import { MoopsySubscribeToTopicEventData } from "@moopsyjs/core/main";
import { MoopsyConnection } from "./connection";

export class PubSubSubscription {
  private readonly creationDate: Date;

  public constructor (
    public readonly connection: MoopsyConnection<any, any>,
    public readonly options: MoopsySubscribeToTopicEventData,
    public readonly topic: string,
    public readonly id: string
  ) {
    this.creationDate = new Date();
  }

  /**
   * Publish data to the PubSubSubscription
   */
  public readonly publish = (data: any): void => {
    this.connection.server.verbose(`[@MoopsyJS/Server] Publishing "${this.topic}" to ${this.connection.id} (SubID="${this.id}")`);
    this.connection.send(
      `publication.${this.topic}`,
      data
    );
  };
}