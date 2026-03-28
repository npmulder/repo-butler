import {
  handleAuth,
  signOut,
  withAuth,
  type NoUserInfo,
  type UserInfo,
} from "@workos-inc/authkit-nextjs";

export type AuthUser = UserInfo;
export type OptionalAuthUser = NoUserInfo | UserInfo;

export async function requireAuth(): Promise<UserInfo> {
  return withAuth({ ensureSignedIn: true });
}

export async function getOptionalAuth(): Promise<OptionalAuthUser> {
  return withAuth();
}

export const authCallbackHandler = handleAuth({
  returnPathname: "/dashboard",
});

export { signOut };
