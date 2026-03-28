import { authkitMiddleware } from "@workos-inc/authkit-nextjs";

export default authkitMiddleware({
  debug: process.env.NODE_ENV === "development",
  redirectUri: process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI,
  middlewareAuth: {
    enabled: true,
    unauthenticatedPaths: [
      "/",
      "/pricing",
      "/docs",
      "/login",
      "/signup",
      "/callback",
      "/api/auth/callback",
      "/api/webhooks(.*)",
    ],
  },
  signUpPaths: ["/signup"],
});
