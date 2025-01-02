import type { ServerOptions } from "socket.io";

/**
 * MoopsyJS used to be called SeamlessJS, we keep the old URL for backwards compatability
 */

export const SOCKETIO_SERVER_CONFIG: Partial<ServerOptions> = {
  path: "/seamless_socketio",
  cors: {
    origin: true,
    methods: ["GET", "POST"],
  },
  destroyUpgrade: false,
};