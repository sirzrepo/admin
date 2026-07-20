import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// ─── Daily: Extract trending templates ───────────────────────────────────────
// Runs every day at 06:00 UTC. Iterates all active brands with completed
// opt-in campaigns and derives trending angle templates from them.
crons.daily(
  "extract trending templates",
  { hourUTC: 6, minuteUTC: 0 },
  internal.campaignTemplates.cronExtractTrendingTemplates
);

// ─── Weekly: Research industry trends ────────────────────────────────────────
// Runs every Monday at 07:00 UTC. Queries distinct active brand industries
// and asks an LLM for top marketing trends, inserting AI-generated templates.
crons.weekly(
  "research industry trends",
  { dayOfWeek: "monday", hourUTC: 7, minuteUTC: 0 },
  internal.campaignTemplates.cronResearchIndustryTrends
);

// ─── Every 15 min: Sync post analytics ──────────────────────────────────────
// Adaptive polling: fresh posts (<24h) sync every 15 min, older posts throttled.
// The action itself skips posts that were recently synced based on age.
crons.interval(
  "sync post analytics",
  { minutes: 15 },
  internal.scheduledPosts.syncPostAnalytics
);

// ─── Every hour: release stale credit reservations ──────────────────────────
// If a task reserves credits but never reaches a terminal state (deploy crash,
// provider outage, or interrupted workflow), release those credits after the
// reservation TTL so balances don't get stuck.
crons.interval(
  "release expired credit reservations",
  { hours: 1 },
  internal.billing.releaseExpiredReservationsInternal,
  {},
);

crons.interval(
  "clean stale generation throttle buckets",
  { hours: 6 },
  internal.billing.cleanupStaleGenerationThrottleBucketsInternal,
  {},
);

// Event-driven checks send low-credit warnings immediately after successful
// charges. This reconciliation catches direct admin edits and missed events.
crons.interval(
  "reconcile low credit notifications",
  { minutes: 15 },
  internal.billing.reconcileLowCreditNotificationsInternal,
  {},
);

// ─── Daily: Retry missing template cover images ──────────────────────────────
// Runs every day at 05:00 UTC. Finds active brand templates without a cover
// (usually caused by transient fal.ai credit exhaustion on first generation)
// and re-schedules cover generation, staggered and rate-limited.
crons.daily(
  "retry missing template covers",
  { hourUTC: 5, minuteUTC: 0 },
  internal.campaignTemplates.cronRetryMissingTemplateCovers
);

// ─── Weekly: Reap orphan reference uploads ──────────────────────────────────
// Runs every Sunday at 04:00 UTC. Deletes R2 objects under brands/*/references/
// that are older than 30 days and not referenced by any agentTasks row.
// Addresses orphans left behind when users upload a reference but skip
// "Save to library" - the file lands in R2 but has no DB anchor.
crons.weekly(
  "reap orphan reference uploads",
  { dayOfWeek: "sunday", hourUTC: 4, minuteUTC: 0 },
  internal.agentTasks.cronReapOrphanUploadReferences,
);

// Destination renditions are disposable delivery artifacts. The source asset
// remains the system of record and an expired rendition is recreated on demand.
crons.weekly(
  "reap expired media renditions",
  { dayOfWeek: "sunday", hourUTC: 4, minuteUTC: 30 },
  internal.mediaRenditions.reapExpiredRenditions,
);

export default crons;
