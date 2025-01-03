/**
 * MoopsyJS used to be called SeamlessJS, we keep the old URL for backwards compatability
 */

import WebSocket, { WebSocketServer } from "ws";
import http from "http";
import EJSON from "ejson";
import EventEmitter from "events";
import express, { Express as ExpressApp, Request, Response } from "express";
import { Socket, Server as SocketIOServer } from "socket.io";
import type { MoopsyAuthenticationSpec } from "@moopsyjs/core";

import { EndpointManager } from "./endpoint-manager";
import { MoopsyConnection } from "./connection";
import { TopicManager } from "./topic-manager";
import { determineIPFromSocket } from "../lib/determine-ip-from-socket";
import { isMoopsyError } from "../lib/is-moopsy-error";
import { SOCKETIO_SERVER_CONFIG } from "../configs/socket-io";
import type {
  HTTPPublicKey,
  MoopsyServerOptionsType,
  ServerCallbacksType,
} from "../types";
import { generateId } from "../lib/generate-id";
import { registerStatusEndpoint } from "../lib/register-status-endpoint";
import { establishCORS } from "../lib/establish-cors";
import { safeJSONParse } from "../lib/safe-json-parse";
import { parseRequestBody } from "../lib/parse-request-body";

/**
 * The main representation of a MoopsyJS server. It is responsible for handling new
 * connections, managing existing connections, and managing the endpoints and topics
 */
export class MoopsyServer<
    AuthSpec extends MoopsyAuthenticationSpec,
    PrivateAuthType
>{
  private readonly httpServer: http.Server;
  private readonly socketIOServer: SocketIOServer;
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
  
  public constructor(
    opts: MoopsyServerOptionsType<AuthSpec["PublicAuthType"], PrivateAuthType>,
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
    this.socketIOServer = new SocketIOServer(this.httpServer, SOCKETIO_SERVER_CONFIG);
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
     * Establish handlers for Moopsy over SocketIO
     */
    this.socketIOServer.on("connection", this.handleNewSocketIOConnection);
    this.wss.on("connection", (connection, request) => {
      this.handleNewWSConnection(connection, request);

      connection.on("ping", () => {
        connection.pong();
      });
    });

    setInterval(() => {
      for(const ws of this.wss.clients) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.ping();
        }
      }
    }, 10_000);
    
    /**
     * Establish and configure handlers for Moopsy over HTTP
     */
    establishCORS(this.expressApp, "/_seamlessjs/http/establish");
    establishCORS(this.expressApp, "/_seamlessjs/http/message");
    this.expressApp.post("/_seamlessjs/http/establish", this.handleHTTPEstablishRequest);
    this.expressApp.post("/_seamlessjs/http/message", this.handleHTTPMessageRequest);
  }

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

  /**
   * Handles an incoming HTTP request to establish a MoopsyJS connection. Used in the
   * HTTP fallback system when the client deems a WebSocket connection to be unstable.
   * 
   * This function should validate the structure of the request, determine any data
   * (hostname, IP, etc) and then pass the data to handleNewConnection.
   * 
   * @returns void
   */
  private readonly handleHTTPEstablishRequest = this._wrapInstrumentation("moopsy::handleHTTPEstablishRequest", async (req: Request, res: Response): Promise<void> => {
    const publicKey: string | null | void | string[] = req.headers["x-seamless-publickey"];

    if(!publicKey || typeof publicKey !== "string") {
      res.status(400).end("Missing x-seamless-publickey");
      return;
    }

    const hostname: string | undefined = req.headers["host"];
    const ip: string | undefined = req.headers["x-forwarded-for"]?.toString() ?? req.connection.remoteAddress;

    // A bit opinionated, but we require that a hostname and IP can be determined
    if(!hostname) {
      res.status(400).end("Unable to determine hostname");
      return;
    }

    if(!ip) {
      res.status(400).end("Unable to determine IP address");
      return;
    }

    const connection: MoopsyConnection<any, any> = this.handleNewConnection(null, hostname, ip, {
      key: publicKey,
      type: "ecdsa",
    });

    res.writeHead(200).end(
      JSON.stringify({
        connectionId: connection.id
      })
    );
  });

  /**
   * Handles an incoming HTTP request to send a message to a MoopsyJS connection. Used in
   * the HTTP fallback system when the client deems a WebSocket connection to be unstable.
   * 
   * Function should validate structure and parse the data from the request and pass it to
   * the connection's handleIncomingHTTPRequest method.
   * 
   * @returns void
   */
  private readonly handleHTTPMessageRequest = this._wrapInstrumentation("moopsy::handleHTTPMessageRequest", async (req: Request, res: Response): Promise<void> => {
    const connectionId: string | null | void | string[] = req.headers["x-seamless-connection-id"];

    if(!connectionId || typeof connectionId !== "string") {
      res.status(400).end("Missing connectionId");
      return;
    }

    const connection: MoopsyConnection<any, any> = this.connections[connectionId];

    if(!connection) {
      res.status(404).end("Connection not found");
      return;
    }

    const rawData: string = await parseRequestBody(req);

    try {
      const data: any = await connection.handleIncomingHTTPRequest(
        safeJSONParse(rawData),
      );

      const responseData: string = EJSON.stringify(data);

      res.writeHead(200).end(responseData);
    }
    catch(e) {
      if(isMoopsyError(e)) {
        res.writeHead(e.code).end(e.message);
      }
      else {
        res.writeHead(500).end("Internal Server Error");
      }
    }
  });

  /**
   * Handles a new SocketIO connection being created. This function should determine any
   * relevant data (hostname, IP, etc) and then hand the socket off to handleNewConnection.
   * 
   * @returns void
   */
  private readonly handleNewSocketIOConnection = this._wrapInstrumentation("moopsy:handleNewSocketIOConnection", (socket: Socket): void => {
    const hostname: string | undefined = socket.handshake.headers.host;

    // Opinionated, but we require a hostname
    if(hostname == null) {
      socket.write("error:missing-hostname");
      socket.disconnect();
      return;
    }

    const ip: string = determineIPFromSocket(socket);

    this.handleNewConnection(socket, hostname, ip, null);
  });

  private readonly handleNewWSConnection = this._wrapInstrumentation("moopsy:handleNewWSConnection", (socket: WebSocket, req: http.IncomingMessage): void => {
    const hostname: string | undefined = req.headers.host;

    // Opinionated, but we require a hostname
    if(hostname == null) {
      socket.send("error:missing-hostname");
      socket.close();
      return;
    }

    const ip: string = req.headers["x-forwarded-for"]?.toString() ?? req.socket.remoteAddress ?? "unknown";

    this.handleNewConnection(socket, hostname, ip, null);
  });

  /**
   * Abstractly handles a new connection, whether SocketIO or HTTP, creating a new
   * MoopsyConnection instance and adding it to the connection pool.
   * 
   * @returns The MoopsyConnection instance that was created
   */
  private handleNewConnection = this._wrapInstrumentation("handleNewConnection", (rawConnection: Socket | null, hostname: string, ip: string, publicKey: HTTPPublicKey | null): MoopsyConnection<AuthSpec["PublicAuthType"], PrivateAuthType> => {
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