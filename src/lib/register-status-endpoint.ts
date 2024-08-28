import type { Express, Request, Response } from "express";

export function registerStatusEndpoint (app: Express): void {
  app.get("/api/status", (req: Request, res: Response) => {
    res.writeHead(200).end("OK");
  });
}