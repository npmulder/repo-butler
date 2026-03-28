import { authkitMiddleware } from "@workos-inc/authkit-nextjs";

export default authkitMiddleware({
  debug: process.env.NODE_ENV === "development",
  redirectUri: process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI,
  middlewareAuth: {
    enabled: true,
    unauthenticatedPaths: ["/", "/login", "/signup"],
  },
  signUpPaths: ["/signup"],
});

export const config = {
  matcher: [
    "/((?!api/auth|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
