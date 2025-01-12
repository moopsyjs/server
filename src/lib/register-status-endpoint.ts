import type { Express, Request, Response } from "express";

export function registerStatusEndpoint (app: Express): void {
  app.get("/api/status", (req: Request, res: Response) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    res.writeHead(200).end("OK");
  });
}