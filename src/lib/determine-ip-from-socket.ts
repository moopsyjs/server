import { Socket } from "socket.io";

export function determineIPFromSocket (rawConnection: Socket): string {
  return rawConnection.handshake.headers["x-forwarded-for"]?.toString() ?? rawConnection.handshake.address;
}