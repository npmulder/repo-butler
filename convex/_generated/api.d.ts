/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type { ComponentApi } from "@convex-dev/workos-authkit/_generated/component.js";
import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";
import type * as issues from "../issues.js";
import type * as repos from "../repos.js";
import type * as runs from "../runs.js";
import type * as users from "../users.js";

declare const fullApi: ApiFromModules<{
  issues: typeof issues;
  repos: typeof repos;
  runs: typeof runs;
  users: typeof users;
}>;
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;
export declare const components: {
  workOSAuthKit: ComponentApi;
};
