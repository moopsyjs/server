import { MoopsyAuthenticationSpec, MoopsyPublishToTopicEventData, MoopsySubscribeToTopicEventData, MoopsyTopicSpecConstsType } from "@moopsyjs/core";

import { PSBPublishHandlerInput, PSBSubscribeHandlerInput, PubSubTyping, MoopsyPubSubTopicPublishHandler, MoopsyPubSubTopicSubscriptionHandler, MoopsyTopicsMapType } from "../types";
import { MoopsyConnection } from "./connection";
import { ForbiddenError } from "./errors/forbidden";
import { TopicNotFoundError } from "./errors/topic-not-found";
import { PubSubSubscription } from "./pubsub-subscription";
import { MoopsyServer } from "./server";
import { generateId } from "../lib/generate-id";

export class TopicManager<AuthSpec extends MoopsyAuthenticationSpec, PrivateAuthType> {
  /**
   * Internal map of topic registrations
   */
  private readonly map: MoopsyTopicsMapType<AuthSpec, PrivateAuthType> = {};
  /**
   * Internal map of topic subscriptions
   */
  private readonly _topicSubscriptions: Record<string, Array<PubSubSubscription>> = {};

  public constructor(private server: MoopsyServer<AuthSpec, PrivateAuthType>) {}

  /**
   * Publish a message to a given topic.
   * 
   * @param topic 
   * @param message 
   * @param skipIvEmit Skips publishing the event on the IV, which distributes the event to other servers
   */
  public readonly publish = (topic: string, message: any, skipIvEmit: boolean = false): void => {
    if (topic in this._topicSubscriptions && this._topicSubscriptions[topic] && Array.isArray(this._topicSubscriptions[topic])) {
      const subscriptions: PubSubSubscription[] = this._topicSubscriptions[topic];

      for (const subscription of subscriptions) {
        subscription.publish(message);
      }
    }
            
    if(!skipIvEmit) {
      this.server.__iv.emit("publish-to-topic", {topic, message});
    }
  };

  public readonly publishMultiple = (events: Array<{ topic: string, message: any }>): void => {
    for( const { topic, message } of events) {
      this.publish(topic, message, false);
    }
  };

  /**
   * Registers a topic
   */
  public readonly register = <PSB extends PubSubTyping>(
    { TopicID }: MoopsyTopicSpecConstsType,
    subscribeHandler: PSBSubscribeHandlerInput<PSB, AuthSpec, PrivateAuthType>,
    publishHandler: PSBPublishHandlerInput<PSB, AuthSpec, PrivateAuthType>
  ): void => {
    if (TopicID in this.map) {
      throw new Error(`Duplicate topic "${TopicID}" registered. You may have mixed up your PSB files or called registerTopic twice.`);
    }
    
    const wrappedSubscribeHandler: MoopsyPubSubTopicSubscriptionHandler<AuthSpec, PrivateAuthType> = async (request, auth, connection) => {
      return await subscribeHandler({topicName:request.topic, auth, connection});
    };
    
    const wrappedPublishHandler: MoopsyPubSubTopicPublishHandler<AuthSpec, PrivateAuthType> = async (request, auth) => {
      return await publishHandler(request.topic, auth);
    };
    
    this.map[TopicID] = {topicId:TopicID, subscribeHandler: wrappedSubscribeHandler, publishHandler:wrappedPublishHandler};
  };

  /**
   * Checks if a topic is registered
   */
  public readonly isTopicRegistered = (topicId: string): boolean => {
    return topicId in this.map;
  };

  /**
   * Deletes the specified PubSubSubscription
   */
  public readonly unsubscribe = (sub: PubSubSubscription): void => {
    const index: number = this._topicSubscriptions[sub.topic].indexOf(sub);

    if(index !== -1) {
      this._topicSubscriptions[sub.topic].splice(index, 1);
    }
  };

  public readonly subscribe = async (connection: MoopsyConnection<AuthSpec, PrivateAuthType>, request: MoopsySubscribeToTopicEventData): Promise<void> =>{
    if (!this._topicSubscriptions[request.topic]) this._topicSubscriptions[request.topic] = [];

    if(!this.isTopicRegistered(request.topicId)) {
      throw new TopicNotFoundError(request.topicId);
    }

    const authenticated: boolean = await this.map[request.topicId].subscribeHandler(request, connection.auth, connection);

    if(!authenticated) {
      throw new ForbiddenError();
    }

    const existingSubscription: PubSubSubscription | void = this._topicSubscriptions[request.topic].find(sub => sub.connection === connection);

    if(existingSubscription != null) {
      return;
    }

    const sub: PubSubSubscription = new PubSubSubscription(
      connection,
      request.topic,
      request.id ?? generateId(16)
    );
    
    connection.pubSubSubscriptions.push(sub);
    this._topicSubscriptions[request.topic].push(sub);
    this.server._emitter.emit("onSuccessfulSubscription", {
      topic: request.topic,
      subscription: sub
    });

    this.server.verbose("PubSub Subscription Created", {topic: request.topic, ip: connection.ip, subId: sub.id, publicAuth: connection.auth?.public ?? null});
  };

  public readonly validatePublishAuth = async (connection: MoopsyConnection<AuthSpec, PrivateAuthType>, request: MoopsyPublishToTopicEventData): Promise<void> => {
    const authenticated: boolean = await this.map[request.topicId].publishHandler(request, connection.auth);

    if(!authenticated) {
      throw new ForbiddenError();
    }
  };
}