/**
 * Endpoint Manager manages your endpoints and safely handles them, implementing
 * rate limiting and params validation.
 */

import EJSON from "ejson";
import { MoopsyError } from "@moopsyjs/core";
import type { RateLimitingConfigType, MoopsyAuthenticationSpec, MoopsyBlueprintConstsType, MoopsyBlueprintPlugType, MoopsyCallType } from "@moopsyjs/core";

import { MoopsyServer } from "./server";
import { ajv } from "../lib/ajv";
import { RateLimiter } from "../lib/rate-limiter";
import { ValidateFunction } from "ajv";
import { isMoopsyError } from "../lib/is-moopsy-error";
import { NotAuthenticatedError } from "./errors/not-authenticated";
import { InvalidRequestError } from "./errors/invalid-request";
import { InternalServerError } from "./errors/internal-server-error";
import { TooManyRequestsError } from "./errors/too-many-requests";
import type { MoopsyConnection } from "./connection";
import type { AuthTypeGeneric } from "../types";

type EndpointHandlerExtrasType<ConnectionAuthType extends AuthTypeGeneric<any, any>> = {
  connection: MoopsyConnection<{ PublicAuthType: ConnectionAuthType["public"], AuthRequestType: any }, ConnectionAuthType["private"]>
}

type EndpointHandlerTypePrivate<Blueprint extends MoopsyBlueprintPlugType, ConnectionAuthType extends AuthTypeGeneric<any, any>> =
  (
    params: Blueprint["params"],
    auth: ConnectionAuthType,
    extras: EndpointHandlerExtrasType<ConnectionAuthType>
  ) => Promise<Blueprint["response"]>
;

type EndpointHandlerTypePublic<Blueprint extends MoopsyBlueprintPlugType, ConnectionAuthType extends AuthTypeGeneric<any, any>> =
  (
    params: Blueprint["params"],
    auth: ConnectionAuthType | null,
    extras: EndpointHandlerExtrasType<ConnectionAuthType>
  ) => Promise<Blueprint["response"]>
;

type EndpointHandlerType<Blueprint extends MoopsyBlueprintPlugType, ConnectionAuthType extends AuthTypeGeneric<any, any>> =
  (
    params: Blueprint["params"],
    auth: any,
    extras: EndpointHandlerExtrasType<ConnectionAuthType>
  ) => Promise<Blueprint["response"]>
;

type EndpointType<
  AuthSpec extends MoopsyAuthenticationSpec,
  PrivateAuthType
> = {
  fn: EndpointHandlerType<any, AuthTypeGeneric<AuthSpec["PublicAuthType"], PrivateAuthType>>;
  requireLogin: boolean;
  rateLimiting: RateLimitingConfigType | null;
}

type EndpointsType<
  AuthSpec extends MoopsyAuthenticationSpec,
  PrivateAuthType
> = Record<string, EndpointType<AuthSpec, PrivateAuthType>>;

interface MoopsyBlueprintConstsTypePrivate extends MoopsyBlueprintConstsType {
  isPublic?: undefined | false;
}

interface MoopsyBlueprintConstsTypePublic extends MoopsyBlueprintConstsType {
  isPublic: true;
}

export class EndpointManager<
  AuthSpec extends MoopsyAuthenticationSpec,
  PrivateAuthType
>{
  /**
   * Internal registry for endpoints
   */
  private readonly _endpoints: EndpointsType<AuthSpec, PrivateAuthType> = {};
  /**
   * Internal reference to the server
   */
  private readonly _server: MoopsyServer<any, any>;

  public constructor(server: MoopsyServer<any, any>) {
    this._server = server;
  }

  /**
   * Register a new Moopsy endpoint
   * 
   * @param blueprint
   * @param handler 
   */
  // These assertions allow us to assert via typing that auth is nullish when the endpoint is public
  public register <Blueprint extends MoopsyBlueprintPlugType>(blueprint: MoopsyBlueprintConstsTypePrivate, handler: EndpointHandlerTypePrivate<Blueprint, AuthTypeGeneric<AuthSpec["PublicAuthType"], PrivateAuthType>>): void;
  public register <Blueprint extends MoopsyBlueprintPlugType>(blueprint: MoopsyBlueprintConstsTypePublic, handler: EndpointHandlerTypePublic<Blueprint, AuthTypeGeneric<AuthSpec["PublicAuthType"], PrivateAuthType>>): void;
  public register <Blueprint extends MoopsyBlueprintPlugType>(blueprint: MoopsyBlueprintConstsType, handler: EndpointHandlerType<Blueprint, AuthTypeGeneric<AuthSpec["PublicAuthType"], PrivateAuthType>>): void {
    if(blueprint.Endpoint in this._endpoints) {
      throw new Error(`Duplicate endpoint "${blueprint.Endpoint}" registered. You may have mixed up your blueprint files or called registerEndpoint twice.`);
    }

    if(!blueprint.paramsSchema) {
      throw new Error(`Schema missing for "${blueprint.Endpoint}". Something might have failed when autogenerating a schema.`);
    }
    
    try {
      ajv.compile(blueprint.paramsSchema);
    }
    catch(e) {
      console.error(`Failed to compile schema for "${blueprint.Endpoint}"`);
      throw e;
    }      

    const wrappedHandler: EndpointHandlerType<Blueprint, AuthTypeGeneric<AuthSpec["PublicAuthType"], PrivateAuthType>> = this._server._wrapInstrumentation(blueprint.Endpoint, async (params, auth, extras) => {
      const validate: ValidateFunction = ajv.compile<Blueprint["params"]>(blueprint.paramsSchema);
      
      if(!validate(params)) {
        this._server.verbose("Params Type Guard Rejection", EJSON.stringify(params), blueprint, validate.errors);
        throw new InvalidRequestError();
      }

      try {
        return await handler(params, auth, extras);
      }
      catch(e: any) {
        if(isMoopsyError(e)) {
          throw e;
        }
        else {
          console.error(`[MoopsyServer] Internal Server Error calling "${blueprint.Endpoint}"`, e);
          throw new InternalServerError();
        }
      }
    });

    this._endpoints[blueprint.Endpoint] = {
      fn: wrappedHandler,
      requireLogin: !blueprint.isPublic,
      rateLimiting: blueprint.RateLimitingConfig ?? null
    };
  }

  /**
   * Retrieve an endpoint by its method name
   */
  private readonly getEndpoint = (method: string): EndpointType<AuthSpec, PrivateAuthType> => {
    if(!(method in this._endpoints)) {
      throw new MoopsyError(404, "endpoint-does-not-exist", `The endpoint "${method}" does not exist`);
    }

    const endpoint: EndpointType<AuthSpec, PrivateAuthType> = this._endpoints[method];
    
    return endpoint;
  };

  /**
   * Retrieve a rate limiter for a given method and connection.
   * Will hard-error if the endpoint does not have rate limiting enabled.
   */
  private readonly getRateLimiter = ({ method, connection, endpoint }: { method: string, connection: MoopsyConnection<any, any>, endpoint: EndpointType<AuthSpec, PrivateAuthType> }): RateLimiter => {
    if(endpoint.rateLimiting == null) {
      throw new Error("Tried to get rate limiter for an endpoint without rate limiting");
    }

    if(!(method in connection.rateLimiters)) {
      connection.rateLimiters[method] = new RateLimiter(endpoint.rateLimiting);
    }

    const limiter: RateLimiter = connection.rateLimiters[method];
    
    return limiter;
  };

  /**
   * Public method, used by MoopsyConnection to handle incoming calls to endpoints
   */
  public readonly handleCall = async (call: MoopsyCallType, connection: MoopsyConnection<any, any>): Promise<unknown> => {
    const endpoint: EndpointType<AuthSpec, PrivateAuthType> = this.getEndpoint(call.method);
    const isAuthenticated: boolean = connection.auth != null;
    
    if(endpoint.requireLogin && isAuthenticated !== true) {
      throw new NotAuthenticatedError();
    }

    if(endpoint.rateLimiting !== null) {
      const limiter: RateLimiter = this.getRateLimiter({ method: call.method, connection, endpoint });

      if(limiter.call() === false) {
        throw new TooManyRequestsError();
      }
    }

    const auth: AuthTypeGeneric<AuthSpec["PublicAuthType"], PrivateAuthType> | null = connection.auth;

    return await endpoint.fn(call.params, auth, { connection });
  };
} 