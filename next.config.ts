import type { NextConfig } from "next";

const requiredWorkosEnvVars = [
  "WORKOS_CLIENT_ID",
  "WORKOS_API_KEY",
  "WORKOS_COOKIE_PASSWORD",
  "NEXT_PUBLIC_WORKOS_REDIRECT_URI",
] as const;

const missingWorkosEnvVars = requiredWorkosEnvVars.filter(
  (name) => !process.env[name],
);

if (missingWorkosEnvVars.length > 0) {
  const message = `Missing required WorkOS environment variables: ${missingWorkosEnvVars.join(
    ", ",
  )}`;

  if (process.env.NODE_ENV === "production") {
    throw new Error(message);
  }

  console.warn(message);
}

const nextConfig: NextConfig = {
  typedRoutes: true,
  typescript: {
    tsconfigPath: "tsconfig.next.json",
  },
};

export default nextConfig;

if (process.env.NODE_ENV !== "production") {
  import("@opennextjs/cloudflare").then((m) => m.initOpenNextCloudflareForDev());
}
