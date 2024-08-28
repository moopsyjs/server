import { Request } from "express";

export async function parseRequestBody (req: Request): Promise<string> {
  return new Promise((resolve, reject) => {
    let raw: string = "";
    
    req.on("data", (chunk: Buffer | string) => {
      raw += chunk.toString();
    });
    
    req.on("end", () => {
      resolve(raw);
    });

    req.on("error", err => {
      reject(err);
    });
  });
}