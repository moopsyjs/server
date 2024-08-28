import { decodeArrayBuffer } from "./array-buffer-encoding";

export function getJWKFromBase64(key: string): JsonWebKey {
  return JSON.parse(Buffer.from(key, "base64").toString("utf8"));
}

export async function importECDSAJWK(jwk: JsonWebKey): Promise<CryptoKey> {
  return await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
}

export async function validateDataWithSignature(data: string, signature: string, publicKey: CryptoKey): Promise<boolean> {
  return await crypto.subtle.verify({name:"ECDSA", hash:"SHA-256"}, publicKey, decodeArrayBuffer(signature), Buffer.from(data, "utf8"));
}