import * as fs from "fs";
import express from "express";

import type { MoopsyServer } from "./server";

/**
 * FrontendServer is a simple utility for serving a straightfowrard bundled
 * frontend application.
 */
export class FrontendServer {
  public constructor(
    private readonly server: MoopsyServer<any, any>
  ) {}

  /**
   * Given a path to a frontend bundle, mounts the bundle on the Express app
   * for serving. Bundle path must be a folder that contains an index.html
   * file
   */
  public readonly mount = (frontendBundlePath: string): void => {
    this.server.expressApp.use(express.static(frontendBundlePath));
    this.server.expressApp.get("*", (req, res, next) => {
      const path: string = frontendBundlePath + "/index.html";
      const requestedPathExists: boolean = fs.existsSync(path);
      
      if(!requestedPathExists) {
        if(req.path.endsWith(".js")) {
          /**
           * If a requested JS file doesn't exist, the client is likely requesting an old version
           * of the JS bundle. We send back `window.location.reload();` to force the client to
           * reload the page and load a new bundle.
           */
          res.writeHead(200);
          res.end("window.location.reload();");
          return;
        }
        else {
          next();
          return;
        }
      }

      res.sendFile(path);
    });        
  };
}