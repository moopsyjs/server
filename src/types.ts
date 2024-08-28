/* eslint-disable @typescript-eslint/no-unused-vars */
import { MoopsyAuthenticationSpec, MoopsyPublishToTopicEventData, MoopsySubscribeToTopicEventData } from "@moopsyjs/core";
import { MoopsyConnection } from "./models/connection";

export type MoopsyPubSubTopicPublishHandler<AuthSpec extends MoopsyAuthenticationSpec, PrivateAuthType> = (data: MoopsyPublishToTopicEventData, auth: MoopsyConnection<AuthSpec, PrivateAuthType>["auth"] | null) => Promise<boolean>;
export type MoopsyPubSubTopicSubscriptionHandler<AuthSpec extends MoopsyAuthenticationSpec, PrivateAuthType> = (data: MoopsySubscribeToTopicEventData, auth: MoopsyConnection<AuthSpec, PrivateAuthType>["auth"] | null, connection: MoopsyConnection<any, any>) => Promise<boolean>;
export type MoopsyPubSubTopicRegistration<AuthSpec extends MoopsyAuthenticationSpec, PrivateAuthType> = {
  topicId: string,
  subscribeHandler: MoopsyPubSubTopicSubscriptionHandler<AuthSpec, PrivateAuthType>,
  publishHandler: MoopsyPubSubTopicPublishHandler<AuthSpec, PrivateAuthType>
};
export type MoopsyTopicsMapType<AuthSpec extends MoopsyAuthenticationSpec, PrivateAuthType> = Record<string, MoopsyPubSubTopicRegistration<AuthSpec, PrivateAuthType>>;

export type MoopsyServerOptionsType<PublicAuth extends MoopsyAuthenticationSpec["PublicAuthType"], PrivateAuth> = {
  port: number;
  
  /**
   * Version of moopsy server. Moopsy will automatically ensure that clients that
   * attempt to connect to it with a mismatching version are rejected.
   */
  version?: string

  verbose?: boolean
  debugLatency?: boolean
  latencyDataHook?: (fn: { method: string, total: number, base: number, sideEffects: number, privateAuth: PrivateAuth | null }) => void 
};

export type PubSubConsts = {
  TopicID: string;
};

export type PubSubTyping = {
  SubscriptionParamsType: any;
  TopicNameType: string;
  MessageType: any;
};

export type AuthType<Pub, Prv> = {
  public: Pub,
  private: Prv
}

export type AuthTypeGeneric<Pub, Prv> = AuthType<Pub, Prv>;

export type AuthTypeMaybe<Pub, Prv> = AuthType<Pub, Prv> | null;

export type MoopsySuccessfulAuthResponsePackage<A,B> = AuthType<A,B>;

export type PSBPublishHandlerInput<
  PSB extends PubSubTyping,
  AuthSpec extends MoopsyAuthenticationSpec,
  PrivateAuthType
> = (
  topicName: PSB["TopicNameType"],
  auth: AuthTypeMaybe<AuthSpec["PublicAuthType"], PrivateAuthType>,
) => Promise<boolean>;

export type PSBSubscribeHandlerInput<
  PSB extends PubSubTyping,
  AuthSpec extends MoopsyAuthenticationSpec,
  PrivateAuthType
> = (data: {
  topicName: PSB["TopicNameType"],
  auth: {
      public: AuthSpec["PublicAuthType"],
      private: PrivateAuthType
  } | null,
  connection: MoopsyConnection<any, any>
}) => Promise<boolean>

export type ServerCallbacksType<AuthSpec extends MoopsyAuthenticationSpec, PrivateAuthType> = {
  handleAuthLogin?: (
    params: AuthSpec["AuthRequestType"],
    details: MoopsyConnection<any, any>
  ) => Promise<
    MoopsySuccessfulAuthResponsePackage<
      AuthSpec["PublicAuthType"],
      PrivateAuthType
    >
  >
};

export interface HTTPPublicKey {
  key: string;
  type: "ecdsa" | "rsa";
}