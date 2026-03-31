/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as approvalGate from "../approvalGate.js";
import type * as artifacts from "../artifacts.js";
import type * as auth from "../auth.js";
import type * as dashboard from "../dashboard.js";
import type * as githubInstallations from "../githubInstallations.js";
import type * as http from "../http.js";
import type * as issues from "../issues.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_githubWebhooks from "../lib/githubWebhooks.js";
import type * as pipeline from "../pipeline.js";
import type * as repoSettings from "../repoSettings.js";
import type * as repos from "../repos.js";
import type * as reproContracts from "../reproContracts.js";
import type * as reproPlans from "../reproPlans.js";
import type * as reproRuns from "../reproRuns.js";
import type * as runs from "../runs.js";
import type * as triageResults from "../triageResults.js";
import type * as users from "../users.js";
import type * as verifications from "../verifications.js";
import type * as webhooks from "../webhooks.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  approvalGate: typeof approvalGate;
  artifacts: typeof artifacts;
  auth: typeof auth;
  dashboard: typeof dashboard;
  githubInstallations: typeof githubInstallations;
  http: typeof http;
  issues: typeof issues;
  "lib/auth": typeof lib_auth;
  "lib/githubWebhooks": typeof lib_githubWebhooks;
  pipeline: typeof pipeline;
  repoSettings: typeof repoSettings;
  repos: typeof repos;
  reproContracts: typeof reproContracts;
  reproPlans: typeof reproPlans;
  reproRuns: typeof reproRuns;
  runs: typeof runs;
  triageResults: typeof triageResults;
  users: typeof users;
  verifications: typeof verifications;
  webhooks: typeof webhooks;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  workOSAuthKit: {
    lib: {
      enqueueWebhookEvent: FunctionReference<
        "mutation",
        "internal",
        {
          apiKey: string;
          event: string;
          eventId: string;
          eventTypes?: Array<string>;
          logLevel?: "DEBUG";
          onEventHandle?: string;
          updatedAt?: string;
        },
        any
      >;
      getAuthUser: FunctionReference<
        "query",
        "internal",
        { id: string },
        {
          createdAt: string;
          email: string;
          emailVerified: boolean;
          externalId?: null | string;
          firstName?: null | string;
          id: string;
          lastName?: null | string;
          lastSignInAt?: null | string;
          locale?: null | string;
          metadata: Record<string, any>;
          profilePictureUrl?: null | string;
          updatedAt: string;
        } | null
      >;
    };
  };
};
