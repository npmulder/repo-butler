import { httpRouter } from "convex/server";

import { authKit } from "./auth";

const http = httpRouter();

if (authKit) {
  authKit.registerRoutes(http);
}

export default http;
