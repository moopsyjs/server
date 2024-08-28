/**
 * Handlers for Moopsy-style array buffer encoding and stringification
 */

export function decodeArrayBuffer(input: string): ArrayBuffer {
  return new Uint8Array(input.split(".").map(Number));
}