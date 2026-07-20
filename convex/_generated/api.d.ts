/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as adminAnalytics from "../adminAnalytics.js";
import type * as adminAuth from "../adminAuth.js";
import type * as adminBillingAnalytics from "../adminBillingAnalytics.js";
import type * as adminDiagnostics from "../adminDiagnostics.js";
import type * as agent from "../agent.js";
import type * as agentTasks from "../agentTasks.js";
import type * as ambassadors from "../ambassadors.js";
import type * as analytics from "../analytics.js";
import type * as auth from "../auth.js";
import type * as billing from "../billing.js";
import type * as billingAdmin from "../billingAdmin.js";
import type * as billingAdminHelper from "../billingAdminHelper.js";
import type * as billingConfig from "../billingConfig.js";
import type * as brands from "../brands.js";
import type * as campaignTemplates from "../campaignTemplates.js";
import type * as campaigns from "../campaigns.js";
import type * as contentPlanner from "../contentPlanner.js";
import type * as crons from "../crons.js";
import type * as data_holidayCalendar from "../data/holidayCalendar.js";
import type * as data_seedAmbassadors from "../data/seedAmbassadors.js";
import type * as data_seedTemplates from "../data/seedTemplates.js";
import type * as data_seedTestAmbassadors from "../data/seedTestAmbassadors.js";
import type * as data_seedTonePresets from "../data/seedTonePresets.js";
import type * as emailTemplates_index from "../emailTemplates/index.js";
import type * as helpers_generateEmail from "../helpers/generateEmail.js";
import type * as helpers_index from "../helpers/index.js";
import type * as http from "../http.js";
import type * as insights from "../insights.js";
import type * as integrations from "../integrations.js";
import type * as invites from "../invites.js";
import type * as lib_errorKind from "../lib/errorKind.js";
import type * as mediaRenditions from "../mediaRenditions.js";
import type * as oauthNonces from "../oauthNonces.js";
import type * as platformConnections from "../platformConnections.js";
import type * as products from "../products.js";
import type * as roles from "../roles.js";
import type * as scheduledPosts from "../scheduledPosts.js";
import type * as scheduling from "../scheduling.js";
import type * as services_email from "../services/email.js";
import type * as services_sendEmail from "../services/sendEmail.js";
import type * as services_tiktok from "../services/tiktok.js";
import type * as specializedAgents_brandGuideAnalyzer from "../specializedAgents/brandGuideAnalyzer.js";
import type * as specializedAgents_characterDesigner from "../specializedAgents/characterDesigner.js";
import type * as specializedAgents_imageGenerator from "../specializedAgents/imageGenerator.js";
import type * as specializedAgents_scriptGenerator from "../specializedAgents/scriptGenerator.js";
import type * as specializedAgents_types from "../specializedAgents/types.js";
import type * as specializedAgents_videoGenerator from "../specializedAgents/videoGenerator.js";
import type * as teams from "../teams.js";
import type * as tonePresets from "../tonePresets.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  adminAnalytics: typeof adminAnalytics;
  adminAuth: typeof adminAuth;
  adminBillingAnalytics: typeof adminBillingAnalytics;
  adminDiagnostics: typeof adminDiagnostics;
  agent: typeof agent;
  agentTasks: typeof agentTasks;
  ambassadors: typeof ambassadors;
  analytics: typeof analytics;
  auth: typeof auth;
  billing: typeof billing;
  billingAdmin: typeof billingAdmin;
  billingAdminHelper: typeof billingAdminHelper;
  billingConfig: typeof billingConfig;
  brands: typeof brands;
  campaignTemplates: typeof campaignTemplates;
  campaigns: typeof campaigns;
  contentPlanner: typeof contentPlanner;
  crons: typeof crons;
  "data/holidayCalendar": typeof data_holidayCalendar;
  "data/seedAmbassadors": typeof data_seedAmbassadors;
  "data/seedTemplates": typeof data_seedTemplates;
  "data/seedTestAmbassadors": typeof data_seedTestAmbassadors;
  "data/seedTonePresets": typeof data_seedTonePresets;
  "emailTemplates/index": typeof emailTemplates_index;
  "helpers/generateEmail": typeof helpers_generateEmail;
  "helpers/index": typeof helpers_index;
  http: typeof http;
  insights: typeof insights;
  integrations: typeof integrations;
  invites: typeof invites;
  "lib/errorKind": typeof lib_errorKind;
  mediaRenditions: typeof mediaRenditions;
  oauthNonces: typeof oauthNonces;
  platformConnections: typeof platformConnections;
  products: typeof products;
  roles: typeof roles;
  scheduledPosts: typeof scheduledPosts;
  scheduling: typeof scheduling;
  "services/email": typeof services_email;
  "services/sendEmail": typeof services_sendEmail;
  "services/tiktok": typeof services_tiktok;
  "specializedAgents/brandGuideAnalyzer": typeof specializedAgents_brandGuideAnalyzer;
  "specializedAgents/characterDesigner": typeof specializedAgents_characterDesigner;
  "specializedAgents/imageGenerator": typeof specializedAgents_imageGenerator;
  "specializedAgents/scriptGenerator": typeof specializedAgents_scriptGenerator;
  "specializedAgents/types": typeof specializedAgents_types;
  "specializedAgents/videoGenerator": typeof specializedAgents_videoGenerator;
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
