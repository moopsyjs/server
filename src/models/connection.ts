import EJSON from "ejson";
import { EventEmitter } from "events";
import {
  MoopsyError,
  MoopsyCallType,
  MoopsyCallResponseType,
  MoopsyAuthenticationSpec,
  MoopsyPublishToTopicEventData,
  MoopsySubscribeToTopicEventData,
  MoopsyRawClientToServerMessageType,
  MoopsyRawServerToClientMessageEventEnum,
  MoopsyRawServerToClientMessageEventType,
  MoopsyRawClientToServerMessageEventEnum,
} from "@moopsyjs/core";

import type { MoopsyServer } from "./server";
import { generateId } from "../lib/generate-id";
import { RateLimiter } from "../lib/rate-limiter";
import { AuthType, HTTPPublicKey } from "../types";
import { safeifyError } from "../lib/safeify-error";
import { UnsupportedError } from "./errors/unsupported";
import type { PubSubSubscription } from "./pubsub-subscription";
import { isMoopsyError } from "../lib/is-moopsy-error";
import { TopicNotFoundError } from "./errors/topic-not-found";
import { ConnectionClosedError } from "./errors/connection-closed";
import { WriteableMoopsyStream } from "./writeable-stream";
import WS, { WebSocket } from "ws";

export class MoopsyConnection<AuthSpec extends MoopsyAuthenticationSpec, PrivateAuthType> {
  private closed: boolean = false;
  private pingTimeout: NodeJS.Timeout | null = null;
  private readonly socketSIO: WebSocket;
  private readonly emitter: EventEmitter = new EventEmitter();
  
  public auth: AuthType<AuthSpec["PublicAuthType"], PrivateAuthType> | null = null;
  public readonly ip: string;
  public readonly id: string;
  public readonly hostname: string;
  public readonly pubSubSubscriptions: Array<WeakRef<PubSubSubscription>> = [];
  public readonly rateLimiters: Record<string, RateLimiter> = {};
  public readonly server: MoopsyServer<AuthSpec["PublicAuthType"], PrivateAuthType>;

  public constructor(rawConnection: WebSocket, hostname: string, ip: string, server: MoopsyServer<AuthSpec["PublicAuthType"], PrivateAuthType>, private publicKey: HTTPPublicKey | null) {
    this.ip = ip; 
    this.server = server;
    this.hostname = hostname;
    this.socketSIO = rawConnection;
    this.id = generateId(16) + Date.now().toString() + ip;
    this.server._emitter.emit("onConnectionOpened", this);
    this.server.emit("connection-opened", this);
    
    this.resetTimeout();

    if(this.socketSIO != null) {
      this.socketSIO.on("message", (evt: string | WS.RawData) => {
        void this.handleRawIncomingMessageFromClient(evt.toString());
      });
      this.socketSIO.on("disconnect", this.handleWebsocketDisconnect);
    }
  }

  private readonly validateNotClosed = (): void => {
    if(this.closed) {
      throw new ConnectionClosedError();
    }
  };

  /**
   * Handles the client disconnecting
   */
  private readonly handleWebsocketDisconnect = async (): Promise<void> => {
    this.closed = true;    

    for(const subRef of this.pubSubSubscriptions) {
      const sub: PubSubSubscription | void = subRef.deref();
      if(sub != null) {
        this.server.topics.unsubscribe(sub);
      }
    }    

    this.emitter.emit("disconnect");
    this.server._emitter.emit("onConnectionClosed", this);
    this.server.emit("connection-closed", this);

    this.server.verbose("Connection Closed", {
      ip: this.ip,
      id: this.id,
      authPublic: this.auth?.public ?? null
    });    
  };

  /**
   * Handles a raw incoming message from the client
   */
  private readonly handleRawIncomingMessageFromClient = async (raw: string): Promise<void> => {
    this.validateNotClosed();

    this.resetTimeout();

    const event: MoopsyRawClientToServerMessageType = EJSON.parse(raw);

    if (event.event === MoopsyRawClientToServerMessageEventEnum.AUTH_LOGIN) {
      await this.handleAuthLoginEvent(event.data);
    }
    if (event.event === MoopsyRawClientToServerMessageEventEnum.PING) {
      await this.handlePingEvent();
    }
    if (event.event === MoopsyRawClientToServerMessageEventEnum.SUBSCRIBE_TO_TOPIC) {
      await this.handleSubscribeToTopicEvent(event.data);
    }
    if (event.event === MoopsyRawClientToServerMessageEventEnum.PUBLISH_TO_TOPIC) {
      await this.handlePublishToTopicEvent(event.data);
    }
    if (event.event === MoopsyRawClientToServerMessageEventEnum.CALL) {
      await this.handleEndpointCall(event.data);
    }
  };

  /**
   * Handle a client's request to authenticate the connection
   */
  private readonly handleAuthLoginEvent = async (data:any): Promise<void> => {
    this.validateNotClosed();

    try {
      if(this.server.callbacks.handleAuthLogin == null) {
        this.send(
          MoopsyRawServerToClientMessageEventEnum.AUTH_ERROR,
          new UnsupportedError()
        );

        return;
      }

      const authResponse: AuthType<AuthSpec["PublicAuthType"], PrivateAuthType> = await this.server.callbacks.handleAuthLogin(data, this);

      this.auth = authResponse;

      this.send(
        MoopsyRawServerToClientMessageEventEnum.AUTH_SUCCESS,
        authResponse.public
      );

      this.server._emitter.emit("onConnectionAuthenticationUpdated", this);
    }
    catch(e: any) {
      if(!e._isMoopsyError) {
        this.server.reportError("Error in handleAuthLogin callback", e);
      }

      const clientSafeError: MoopsyError = isMoopsyError(e) ? e : new MoopsyError(500, "Internal Server Error");
          
      this.send(MoopsyRawServerToClientMessageEventEnum.AUTH_ERROR, clientSafeError); return;
    }
  };

  /**
   * Handle a client's ping message
   */
  private readonly handlePingEvent = async (): Promise<void> => {
    this.validateNotClosed();
    this.send("pong", { connectionId: this.id });
  };

  /**
   * Handle a client's request to subscribe to a topic
   */
  private readonly handleSubscribeToTopicEvent = async (data: MoopsySubscribeToTopicEventData): Promise<void> => {
    this.validateNotClosed();

    try {
      await this.server.topics.subscribe(this, data);

      this.send(
        `subscription-result.${data.topic}`,
        true
      );
    }
    catch(e: any) {
      this.send(
        `subscription-result.${data.topic}`,
        { error: safeifyError(e) }
      );      
    }
  };

  /**
   * Handle a client's request to publish to a topic
   */
  private readonly handlePublishToTopicEvent = async (request: MoopsyPublishToTopicEventData): Promise<void> => {
    this.validateNotClosed();

    if(!this.server.topics.isTopicRegistered(request.topicId)) {
      throw new TopicNotFoundError(request.topicId);
    }

    try {    
      await this.server.topics.validatePublishAuth(this, request);
      this.server.topics.publish(request.topic, request.data, false);
    }
    catch(e: any) {
      this.send(
        `publication-error.${request.topic}`,
        { error: safeifyError(e) }
      );      
    }
  };

  /**
   * Perform a call to a Moopsy endpoint
   */
  private readonly performMoopsyCall = async (call: MoopsyCallType): Promise<unknown> => {
    this.validateNotClosed();

    return await this.server.endpoints.handleCall(call, this);
  };

  /**
   * Handle a client's incoming call to an endpoint
   */
  private readonly handleEndpointCall = async (data: MoopsyCallType): Promise<void> => {
    try {
      this.validateNotClosed();

      const startBase: number = Date.now();
      const result: unknown = await this.performMoopsyCall(data);
      const endBase: number = Date.now();

      const startSideEffects: number = Date.now();
      const sideEffectResults: Array<{sideEffectId:string | number, result:any}> = [];

      if(data.sideEffects != null) {
        for (const se of data.sideEffects) {
          const result: unknown = await this.performMoopsyCall({ callId: "se" + se.sideEffectId.toString(), method: se.method, params: se.params });

          sideEffectResults.push({
            sideEffectId:se.sideEffectId,
            result
          });
        }
      }
      const endSideEffects: number = Date.now();

      const responseMessage: MoopsyCallResponseType = {
        mutationResult: result,
        sideEffectResults,
      };

      this.send(`response.${data.callId}`, responseMessage);    

      if(typeof result === "object" && result instanceof Object) {
        // If the result is a WriteableMoopsyStream, we listen for changes
        for(const value of Object.values(result)) {
          if(value instanceof WriteableMoopsyStream) {
            this.send(`response.${data.callId}.${value.id}`, value.read());
            value.onChange(() => {
              this.send(`response.${data.callId}.${value.id}`, value.read());
            });
          }
        }
      }

      if(this.server.opts.debugLatency === true && this.server.opts.latencyDataHook != null) {
        this.server.opts.latencyDataHook({
          method: data.method,
          total: endSideEffects - startBase,
          base: endBase - startBase,
          sideEffects: endSideEffects - startSideEffects,
          privateAuth: this.auth?.private ?? null
        });
      }      
    }
    catch (err: any) {
      this.send(`response.${data.callId}`, safeifyError(err));    
    }        
  };

  /**
   * Handle the ping timeout being reached
   */
  private readonly onPingTimeout = (): void => {
    this.server.verbose("warning", "[MoopsyServer] Ping timeout, closing connection");

    try {
      this.send("connection-closed", { reason: "ping-timeout" });
    }
    catch(e) {
      console.error(e);
    }

    this.forceDisconnect(3999, "ping-timeout");
  };

  /**
   * Reset the ping timeout
   */
  private readonly resetTimeout = (): void => {
    this.validateNotClosed();

    if(this.pingTimeout != null) {
      clearTimeout(this.pingTimeout);
    }
    
    this.pingTimeout = setTimeout(this.onPingTimeout, 30000);
  };

  /**
   * Send a raw message to the client
   */
  public readonly send = (event: MoopsyRawServerToClientMessageEventType, data = {}): void => {
    try {
      const raw: string = EJSON.stringify({ event, data });
      this.socketSIO.send(raw);
    }
    catch (e: any) {
      this.server.reportError("Failed to send", e, { event, data });
    }
  };

  public readonly forceDisconnect = (code: number, reason: string): void => {
    void this.handleWebsocketDisconnect();

    if(this.socketSIO == null) {
      return;
    }

    this.socketSIO.close(code, reason);
  };

  public readonly onDisconnect = (cb: () => void): void => {
    this.emitter.on("disconnect", cb);
  };

  public toJSON(): object {
    return { id: this.id, ip: this.ip, hostname: this.hostname };
  }
}
