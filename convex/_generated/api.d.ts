/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as agent from "../agent.js";
import type * as agentTasks from "../agentTasks.js";
import type * as ambassadors from "../ambassadors.js";
import type * as auth from "../auth.js";
import type * as brandCampaignTemplates from "../brandCampaignTemplates.js";
import type * as brands from "../brands.js";
import type * as campaignTemplates from "../campaignTemplates.js";
import type * as campaigns from "../campaigns.js";
import type * as emailTemplates_index from "../emailTemplates/index.js";
import type * as helpers_generateEmail from "../helpers/generateEmail.js";
import type * as helpers_index from "../helpers/index.js";
import type * as http from "../http.js";
import type * as integrations from "../integrations.js";
import type * as invites from "../invites.js";
import type * as notifications from "../notifications.js";
import type * as platformConnections from "../platformConnections.js";
import type * as products from "../products.js";
import type * as roles from "../roles.js";
import type * as scheduledPosts from "../scheduledPosts.js";
import type * as seedTemplates from "../seedTemplates.js";
import type * as specializedAgents_characterDesigner from "../specializedAgents/characterDesigner.js";
import type * as specializedAgents_types from "../specializedAgents/types.js";
import type * as teams from "../teams.js";
import type * as tonePresets from "../tonePresets.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  agent: typeof agent;
  agentTasks: typeof agentTasks;
  ambassadors: typeof ambassadors;
  auth: typeof auth;
  brandCampaignTemplates: typeof brandCampaignTemplates;
  brands: typeof brands;
  campaignTemplates: typeof campaignTemplates;
  campaigns: typeof campaigns;
  "emailTemplates/index": typeof emailTemplates_index;
  "helpers/generateEmail": typeof helpers_generateEmail;
  "helpers/index": typeof helpers_index;
  http: typeof http;
  integrations: typeof integrations;
  invites: typeof invites;
  notifications: typeof notifications;
  platformConnections: typeof platformConnections;
  products: typeof products;
  roles: typeof roles;
  scheduledPosts: typeof scheduledPosts;
  seedTemplates: typeof seedTemplates;
  "specializedAgents/characterDesigner": typeof specializedAgents_characterDesigner;
  "specializedAgents/types": typeof specializedAgents_types;
  teams: typeof teams;
  tonePresets: typeof tonePresets;
  users: typeof users;
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
  agent: import("@convex-dev/agent/_generated/component.js").ComponentApi<"agent">;
};
