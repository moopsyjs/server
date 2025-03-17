/**
 * MoopsyJS used to be called SeamlessJS, we keep the old URL for backwards compatability
 */

import http from "http";
import EventEmitter from "events";
import WebSocket, { WebSocketServer } from "ws";
import express, { Express as ExpressApp } from "express";
import type { MoopsyAuthenticationSpec } from "@moopsyjs/core";

import { EndpointManager } from "./endpoint-manager";
import { MoopsyConnection } from "./connection";
import { TopicManager } from "./topic-manager";
import type {
  HTTPPublicKey,
  MoopsyServerOptionsType,
  ServerCallbacksType,
} from "../types";
import { generateId } from "../lib/generate-id";
import { registerStatusEndpoint } from "../lib/register-status-endpoint";
import { TypedEventEmitterV3 } from "@moopsyjs/toolkit/main";
import { PubSubSubscription } from "./pubsub-subscription";

/**
 * The main representation of a MoopsyJS server. It is responsible for handling new
 * connections, managing existing connections, and managing the endpoints and topics
 */
export class MoopsyServer<
    AuthSpec extends MoopsyAuthenticationSpec,
    PrivateAuthType
>{
  private readonly httpServer: http.Server;
  private readonly wss: WebSocketServer;
  public readonly serverId: string;
  public readonly connections: Record<string, MoopsyConnection<AuthSpec["PublicAuthType"], PrivateAuthType>> = {};
  public readonly __iv = new EventEmitter(); // Used by packages that install onto MoopsyServer
  public readonly expressApp: ExpressApp;
  public readonly callbacks: ServerCallbacksType<AuthSpec, PrivateAuthType>;
  /**
   * The EndpointManager instance for this server. Used to manage all endpoints this server
   * is capable of handling.
   */
  public readonly endpoints: EndpointManager<AuthSpec, PrivateAuthType> = new EndpointManager(this);
  /**
   * The TopicManager instance for this server. Used to manage all topics this server is
   * capable of handling.
   */
  public readonly topics: TopicManager<AuthSpec, PrivateAuthType> = new TopicManager(this);
  public readonly opts: MoopsyServerOptionsType<AuthSpec["PublicAuthType"], PrivateAuthType>;
  public readonly _emitter = new EventEmitter();
  
  // New Emitter
  private readonly emitter: TypedEventEmitterV3<{
    "pubsub-subscription-created": PubSubSubscription;
    "pubsub-subscription-deleted": PubSubSubscription;
    "connection-opened": MoopsyConnection<AuthSpec["PublicAuthType"], PrivateAuthType>;
    "connection-closed": MoopsyConnection<AuthSpec["PublicAuthType"], PrivateAuthType>;
  }> = new TypedEventEmitterV3();

  public readonly on = this.emitter.on;
  public readonly off = this.emitter.off;
  public readonly emit = this.emitter.emit;
  
  public constructor(
    opts: MoopsyServerOptionsType<AuthSpec["PublicAuthType"], PrivateAuthType>,
    /**
     * @deprecated use server.registerAuthHandler() instead
     */
    callbacks: ServerCallbacksType<AuthSpec, PrivateAuthType>,
  ) {
    /**
     * Save initial data
     */
    this.opts = opts;
    this.callbacks = callbacks;
    this.serverId = generateId(20);
    
    /**
     * Create the Express App, HTTP Server, and SocketIO Server
     */
    this.expressApp = express();
    registerStatusEndpoint(this.expressApp);
    this.httpServer = this.expressApp.listen(this.opts.port);
    this.wss = new WebSocketServer({ noServer: true });

    this.httpServer.on("upgrade", (request, socket, head) => {
      const pathname: string = new URL(request.url ?? "", `http://${request.headers.host}`).pathname;

      if (pathname === "/moopsy_ws") {
        this.wss.handleUpgrade(request, socket, head, (ws) => {
          this.wss.emit("connection", ws, request);
        });
      }
    });

    /**
     * Establish handlers for Moopsy over Websocket
     */
    this.wss.on("connection", this.handleNewWSConnection);

    setInterval(() => {
      for(const id in this.connections) {
        this.connections[id].send("pong", {});
      }
    }, 15_000);
  }

  /**
   * Registers a handler for handling authentication requests. If you do not register
   * one clients will not be able to authenticate.
   * 
   * This handler should do something like validate a token, NOT validate a username
   * and password. Instead, setup a method that handles the initial process and returns
   * some sort of token, and use that token to authenticate your Moopsy connection.
   */
  public readonly registerAuthHandler = (authHandler: Exclude<ServerCallbacksType<AuthSpec, PrivateAuthType>["handleAuthLogin"], undefined>): void => {
    this.callbacks.handleAuthLogin = authHandler;
  };

  public readonly _wrapInstrumentation = <T>(label: string, fn: (...params: any[]) => T): typeof fn => {
    return (...params: any[]) => {
      const instrumentationHook: ((label: string, fn: () => T) => T) | null = this.opts.instrumentationHook ?? null;
      
      if(instrumentationHook != null) {
        return instrumentationHook(label, () => fn(...params));
      }
      else {
        return fn(...params);
      }
    };
  };

  private readonly handleNewWSConnection = this._wrapInstrumentation("moopsy:handleNewWSConnection", (socket: WebSocket, req: http.IncomingMessage): void => {
    const hostname: string | undefined = req.headers.host;

    // Opinionated, but we require a hostname
    if(hostname == null) {
      socket.send("error:missing-hostname");
      socket.close(3998, "missing-hostname");
      return;
    }

    const ip: string = req.headers["x-forwarded-for"]?.toString() ?? req.socket.remoteAddress ?? "unknown";

    this.handleNewConnection(socket, hostname, ip, null);

    socket.on("ping", () => {
      socket.pong();
    });
  });

  /**
   * Abstractly handles a new connection, whether SocketIO or HTTP, creating a new
   * MoopsyConnection instance and adding it to the connection pool.
   * 
   * @returns The MoopsyConnection instance that was created
   */
  private handleNewConnection = this._wrapInstrumentation("handleNewConnection", (rawConnection: WebSocket, hostname: string, ip: string, publicKey: HTTPPublicKey | null): MoopsyConnection<AuthSpec["PublicAuthType"], PrivateAuthType> => {
    const connection: MoopsyConnection<AuthSpec["PublicAuthType"], PrivateAuthType> = new MoopsyConnection(
      rawConnection, hostname, ip, this, publicKey
    );

    if(connection.id in this.connections) {
      throw new Error("Tried to add new connection with duplicate id " + connection.id);
    }

    this.connections[connection.id] = connection;

    connection.onDisconnect(() => {
      delete this.connections[connection.id];
    });

    return connection;
  });

  /**
   * Public (consumed by MoopsyConnection) method to emit `onConnectionAuthenticationUpdated`
   * 
   * @returns void
   */
  public readonly onConnectionAuthenticationUpdated = (cb: (params: MoopsyConnection<AuthSpec, PrivateAuthType>) => Promise<void>): void => {
    this._emitter.on("onConnectionAuthenticationUpdated", cb);
  };

  /**
   * Public (consumed by MoopsyConnection) method to emit `onConnectionOpened`
   * 
   * @returns void
   */
  public readonly onConnectionOpened = (cb: (params: MoopsyConnection<AuthSpec, PrivateAuthType>) => Promise<void>): void => {
    this._emitter.on("onConnectionOpened", cb);
  };

  /**
   * Public (consumed by MoopsyConnection) method to emit `onConnectionClosed`
   * 
   * @returns void
   */
  public readonly onConnectionClosed = (cb: (params: MoopsyConnection<AuthSpec, PrivateAuthType>) => Promise<void>): void => {
    this._emitter.on("onConnectionClosed", cb);
  };

  /**
   * [Util] Logs a message to console if opts.verbose is true
   * 
   * @returns void
   */
  public readonly verbose = (...args: any[]): void => {
    if(this.opts.verbose === true) {
      console.log(...args);
    }
  };

  /**
   * [Util] Logs an error to console. Logging takes place regardless of opts.verbose
   * 
   * @returns void
   */
  public readonly reportError = (message: string, error: Error, data?: any): void => {
    console.error("@moopsyjs/server", message, data, error);
  };  
}