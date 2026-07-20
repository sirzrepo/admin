import { action, internalMutation, internalQuery, mutation, query, internalAction } from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { api, internal } from "./_generated/api";
import { uploadVideoToTikTok, uploadPhotoToTikTok, queryCreatorInfo, getVideoAnalytics, checkPublishStatus, validateTikTokDisclosureSettings } from "./services/tiktok";
import { getCurrentTeamMember } from "./helpers";

export const createScheduledPost = mutation({
  args: {
    campaignId: v.id("campaigns"),
    platform: v.string(),
    assetUrl: v.string(),
    mediaType: v.optional(v.string()),
    caption: v.string(),
    scheduledAt: v.number(),
    taskId: v.optional(v.id("agentTasks")),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("unauthenticated");

    const campaign = await ctx.db.get(args.campaignId);
    if (!campaign) throw new Error("campaign not found");

    const brand = await ctx.db.get(campaign.brandId);
    if (!brand || brand.userId !== userId) {
      throw new Error("not authorized");
    }

    const postId = await ctx.db.insert("scheduledPosts", {
      campaignId: args.campaignId,
      brandId: campaign.brandId,
      taskId: args.taskId,
      platform: args.platform,
      assetUrl: args.assetUrl,
      mediaType: args.mediaType,
      caption: args.caption,
      scheduledAt: args.scheduledAt,
      status: "scheduled",
      createdAt: Date.now(),
    });

    if (args.scheduledAt <= Date.now()) {
      await ctx.scheduler.runAfter(0, internal.scheduledPosts.publishScheduledPost, { postId });
    } else {
      await ctx.scheduler.runAt(args.scheduledAt, internal.scheduledPosts.publishScheduledPost, { postId });
    }

    return postId;
  },
});

export const listPostsByCampaign = query({
  args: { campaignId: v.id("campaigns") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const campaign = await ctx.db.get(args.campaignId);
    if (!campaign) return [];

    const brand = await ctx.db.get(campaign.brandId);
    if (!brand || brand.userId !== userId) return [];

    return await ctx.db
      .query("scheduledPosts")
      .withIndex("by_campaignId", (q) => q.eq("campaignId", args.campaignId))
      .collect();
  },
});

export const listUpcomingPosts = query({
  args: { brandId: v.id("brands") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const brand = await ctx.db.get(args.brandId);
    if (!brand || brand.userId !== userId) return [];

    const posts = await ctx.db
      .query("scheduledPosts")
      .withIndex("by_brandId", (q) => q.eq("brandId", args.brandId))
      .filter((q) => q.eq(q.field("status"), "scheduled"))
      .collect();

    return posts.sort((a, b) => a.scheduledAt - b.scheduledAt);
  },
});

// All posts for the content planner - includes scheduled, posted, failed
export const listAllPosts = query({
  args: { brandId: v.id("brands") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const brand = await ctx.db.get(args.brandId);
    if (!brand || brand.userId !== userId) return [];

    return await ctx.db
      .query("scheduledPosts")
      .withIndex("by_brandId", (q) => q.eq("brandId", args.brandId))
      .collect();
  },
});

export const backfillScheduledPostMediaTypes = mutation({
  args: { brandId: v.id("brands") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("unauthenticated");

    const brand = await ctx.db.get(args.brandId);
    if (!brand || brand.userId !== userId) throw new Error("not authorized");

    const posts = await ctx.db
      .query("scheduledPosts")
      .withIndex("by_brandId", (q) => q.eq("brandId", args.brandId))
      .collect();

    let updated = 0;
    for (const post of posts) {
      if (post.mediaType === "image" || post.mediaType === "video") continue;

      let mediaType: "image" | "video" = looksLikeImageUrl(post.assetUrl) ? "image" : "video";
      if (post.taskId) {
        const task = await ctx.db.get(post.taskId);
        if (task?.output?.videoUrl) mediaType = "video";
        else if (task?.output?.imageUrl) mediaType = "image";
      }

      await ctx.db.patch(post._id, { mediaType });
      updated++;
    }

    return { scanned: posts.length, updated };
  },
});

export const updatePostStatus = mutation({
  args: {
    postId: v.id("scheduledPosts"),
    status: v.string(),
    platformPostId: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("unauthenticated");

    const post = await ctx.db.get(args.postId);
    if (!post) throw new Error("post not found");

    const brand = await ctx.db.get(post.brandId);
    if (!brand || brand.userId !== userId) {
      throw new Error("not authorized");
    }

    const updates: Record<string, unknown> = {
      status: args.status,
    };

    if (args.status === "posted") {
      updates.postedAt = Date.now();
    }

    if (args.platformPostId) {
      updates.platformPostId = args.platformPostId;
    }

    if (args.error) {
      updates.error = args.error;
    }

    await ctx.db.patch(args.postId, updates);
    return args.postId;
  },
});

export const cancelCampaignPosts = mutation({
  args: { campaignId: v.id("campaigns") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("unauthenticated");

    const campaign = await ctx.db.get(args.campaignId);
    if (!campaign) throw new Error("campaign not found");

    const brand = await ctx.db.get(campaign.brandId);
    if (!brand || brand.userId !== userId) {
      throw new Error("not authorized");
    }

    const posts = await ctx.db
      .query("scheduledPosts")
      .withIndex("by_campaignId", (q) => q.eq("campaignId", args.campaignId))
      .filter((q) => q.eq(q.field("status"), "scheduled"))
      .collect();

    for (const post of posts) {
      await ctx.db.patch(post._id, { status: "cancelled" });
    }

    return posts.length;
  },
});

export const suggestPostingTimes = query({
  args: { brandId: v.id("brands") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const brand = await ctx.db.get(args.brandId);
    if (!brand || brand.userId !== userId) return [];

    const connection = await ctx.db
      .query("platformConnections")
      .withIndex("by_brandId_platform", (q) => 
        q.eq("brandId", args.brandId).eq("platform", "tiktok")
      )
      .filter((q) => q.eq(q.field("isActive"), true))
      .first();

    if (!connection) {
      return [
        { day: "Monday", time: "09:00" },
        { day: "Wednesday", time: "12:00" },
        { day: "Friday", time: "18:00" },
      ];
    }

    return [
      { day: "Monday", time: "09:00" },
      { day: "Wednesday", time: "12:00" },
      { day: "Friday", time: "18:00" },
      { day: "Saturday", time: "10:00" },
      { day: "Sunday", time: "20:00" },
    ];
  },
});

// ─── Internal helpers for publishScheduledPost (actions can't use ctx.db) ─────

export const getPostForPublishing = internalQuery({
  args: { postId: v.id("scheduledPosts") },
  handler: async (ctx, args) => {
    const post = await ctx.db.get(args.postId);
    if (!post) return null;

    const connection = await ctx.db
      .query("platformConnections")
      .withIndex("by_brandId_platform", (q) =>
        q.eq("brandId", post.brandId).eq("platform", post.platform)
      )
      .filter((q) => q.eq(q.field("isActive"), true))
      .first();

    return { post, connection };
  },
});

export const resolvePostMediaType = internalQuery({
  args: { postId: v.id("scheduledPosts") },
  handler: async (ctx, args) => {
    const post = await ctx.db.get(args.postId);
    if (!post) return "video";
    if (post.mediaType === "image" || post.mediaType === "video") return post.mediaType;

    if (post.taskId) {
      const task = await ctx.db.get(post.taskId);
      if (task?.output?.videoUrl) return "video";
      if (task?.output?.imageUrl) return "image";
    }

    return looksLikeImageUrl(post.assetUrl) ? "image" : "video";
  },
});

export const updatePostAfterPublish = internalMutation({
  args: {
    postId: v.id("scheduledPosts"),
    status: v.string(),
    postedAt: v.optional(v.number()),
    platformPostId: v.optional(v.string()),
    error: v.optional(v.string()),
    assetUrl: v.optional(v.string()),
    mediaType: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const updates: Record<string, unknown> = { status: args.status };
    if (args.postedAt) updates.postedAt = args.postedAt;
    if (args.platformPostId) updates.platformPostId = args.platformPostId;
    if (args.error) updates.error = args.error;
    if (args.assetUrl) updates.assetUrl = args.assetUrl;
    if (args.mediaType) updates.mediaType = args.mediaType;
    await ctx.db.patch(args.postId, updates);
  },
});

export const backfillPostMediaType = internalMutation({
  args: {
    postId: v.id("scheduledPosts"),
    mediaType: v.union(v.literal("video"), v.literal("image")),
  },
  handler: async (ctx, args) => {
    const post = await ctx.db.get(args.postId);
    if (!post || post.mediaType) return;
    await ctx.db.patch(args.postId, { mediaType: args.mediaType });
  },
});

export const createPostNotification = internalMutation({
  args: {
    brandId: v.id("brands"),
    campaignId: v.id("campaigns"),
    type: v.string(),
    title: v.string(),
    message: v.string(),
  },
  handler: async (ctx, args) => {
    const brand = await ctx.db.get(args.brandId);
    if (!brand) return;
    await ctx.db.insert("notifications", {
      userId: brand.userId,
      brandId: args.brandId,
      type: args.type,
      title: args.title,
      message: args.message,
      link: `/creator?campaign=${args.campaignId}`,
      read: false,
      createdAt: Date.now(),
    });
  },
});

// ─── Auto-transition campaign status based on post outcomes ─────────────────
// Called after every terminal post state (posted/failed).
// scheduled -> active (first post goes out, or failed posts need attention)
// active -> completed only when every scheduled post is posted.

export const syncCampaignStatusFromPosts = internalMutation({
  args: { campaignId: v.id("campaigns") },
  handler: async (ctx, args) => {
    const campaign = await ctx.db.get(args.campaignId);
    if (!campaign) return;

    // Only auto-transition from scheduled or active
    if (campaign.status !== "scheduled" && campaign.status !== "active") return;

    const posts = await ctx.db
      .query("scheduledPosts")
      .withIndex("by_campaignId", (q) => q.eq("campaignId", args.campaignId))
      .collect();

    if (posts.length === 0) return;

    const anyPosted = posts.some(p => p.status === "posted");
    const anyFailed = posts.some(p => p.status === "failed");
    const allPostsPosted = posts.every(p => p.status === "posted");
    const allPostsTerminal = posts.every(p => p.status === "posted" || p.status === "failed");

    // Check if there are completed videos that haven't been scheduled yet
    const videoTasks = await ctx.db
      .query("agentTasks")
      .withIndex("by_campaignId", (q) => q.eq("campaignId", args.campaignId))
      .collect();
    const completedVideos = videoTasks.filter(
      t => t.agentType === "video_generator" && t.status === "completed" && (t.output?.videoUrl || t.output?.imageUrl)
    );
    const scheduledTaskIds = new Set(posts.map(p => p.taskId).filter(Boolean));
    const hasUnscheduledVideos = completedVideos.some(v => !scheduledTaskIds.has(v._id));

    if (allPostsPosted && !hasUnscheduledVideos) {
      // Every scheduled post was published and no generated asset is waiting.
      await ctx.db.patch(args.campaignId, {
        status: "completed",
        completedAt: Date.now(),
        updatedAt: Date.now(),
      });
    } else if ((anyPosted || (anyFailed && allPostsTerminal)) && campaign.status === "scheduled") {
      // Keep failed campaigns visible in Campaign Detail for retry instead of
      // sending them back into the wizard's generation-failed flow.
      await ctx.db.patch(args.campaignId, {
        status: "active",
        updatedAt: Date.now(),
      });
    }
  },
});

// ─── Main publish action ─────────────────────────────────────────────────────

export const publishScheduledPost = internalAction({
  args: { postId: v.id("scheduledPosts"), retryCount: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const retryCount = args.retryCount || 0;
    const maxRetries = 2; // 3 total attempts: initial (0) + 2 retries

    // Fetch post + connection via internalQuery (actions can't read DB directly)
    const data = await ctx.runQuery(internal.scheduledPosts.getPostForPublishing, {
      postId: args.postId,
    });

    if (!data?.post) {
      console.error(`[publishScheduledPost] Post not found: ${args.postId}`);
      return;
    }

    const { post, connection } = data;

    if (post.status !== "scheduled" && post.status !== "paused" && post.status !== "publishing") {
      console.log(`[publishScheduledPost] Post ${args.postId} is not schedulable (status: ${post.status}), skipping`);
      return;
    }

    // Mark as publishing on first attempt so UI reflects the active state
    if (retryCount === 0) {
      await ctx.runMutation(internal.scheduledPosts.updatePostAfterPublish, {
        postId: args.postId,
        status: "publishing",
      });
    }

    if (!connection) {
      if (retryCount < maxRetries) {
        const delay = Math.pow(2, retryCount) * 60000;
        console.log(`[publishScheduledPost] No connection, retrying in ${delay}ms (attempt ${retryCount + 1})`);
        await ctx.scheduler.runAt(Date.now() + delay, internal.scheduledPosts.publishScheduledPost, {
          postId: args.postId,
          retryCount: retryCount + 1,
        });
      } else {
        await ctx.runMutation(internal.scheduledPosts.updatePostAfterPublish, {
          postId: args.postId,
          status: "failed",
          error: "No active platform connection found after 3 retries",
        });
      }
      return;
    }

    // Safety net: ensure assetUrl is on R2 before posting. fal.ai temp URLs
    // expire within hours, so if the source task was completed via the
    // polling path (where persistence used to be missed) or persistence
    // failed silently, we recover here by forcing R2 persistence and
    // re-resolving the URL. Idempotent: persistAssetToR2 no-ops if URLs
    // are already on R2.
    let resolvedAssetUrl = post.assetUrl;
    if (post.taskId && !post.assetUrl.includes("r2.dev")) {
      console.log(`[publishScheduledPost] Asset URL not on R2 for post ${args.postId}, forcing persistence`);
      await ctx.runAction(internal.agentTasks.persistAssetToR2, { taskId: post.taskId });
      const refreshed = await ctx.runQuery(internal.agentTasks.getTaskInternal, { taskId: post.taskId });
      const refreshedUrl = refreshed?.output?.videoUrl ?? refreshed?.output?.imageUrl;
      if (refreshedUrl && refreshedUrl.includes("r2.dev")) {
        resolvedAssetUrl = refreshedUrl;
        // Patch the post so subsequent retries skip this work.
        await ctx.runMutation(internal.scheduledPosts.updatePostAfterPublish, {
          postId: args.postId,
          status: "publishing",
          assetUrl: refreshedUrl,
        });
      } else {
        // Persistence couldn't recover the asset - fail cleanly rather than
        // burning retries against a dead fal.ai URL.
        await ctx.runMutation(internal.scheduledPosts.updatePostAfterPublish, {
          postId: args.postId,
          status: "failed",
          error: "Asset is no longer available (fal.ai URL expired and R2 persistence failed). Re-generate the asset and schedule a new post.",
        });
        return;
      }
    }

    const mediaType = await ctx.runQuery(internal.scheduledPosts.resolvePostMediaType, {
      postId: args.postId,
    });
    await ctx.runMutation(internal.scheduledPosts.backfillPostMediaType, {
      postId: args.postId,
      mediaType,
    });

    if (mediaType === "image") {
      try {
        const rendition = await ctx.runAction(internal.mediaRenditions.prepareImageForDestination, {
          brandId: post.brandId,
          sourceUrl: resolvedAssetUrl,
          destination: "tiktok-photo",
        });
        resolvedAssetUrl = rendition.url;
      } catch (error) {
        const message = error instanceof Error
          ? error.message
          : "We could not prepare this image for TikTok.";
        await ctx.runMutation(internal.scheduledPosts.updatePostAfterPublish, {
          postId: args.postId,
          status: "failed",
          error: message,
        });
        await ctx.runMutation(internal.scheduledPosts.syncCampaignStatusFromPosts, {
          campaignId: post.campaignId,
        });
        return;
      }
    }

    try {
      if (post.platform === "tiktok") {
        const tiktokSettings = (post as any).tiktokSettings || {};

        const tokenResult = await ctx.runAction(internal.platformConnections.ensureFreshTikTokAccessToken, {
          brandId: post.brandId,
        });
        if ("error" in tokenResult) {
          await ctx.runMutation(internal.scheduledPosts.updatePostAfterPublish, {
            postId: args.postId,
            status: "failed",
            error: tokenResult.error === "refresh_token_invalid" || tokenResult.error === "no_refresh_token"
              ? "TikTok connection expired - please reconnect TikTok and try again."
              : `TikTok token refresh failed: ${tokenResult.error}`,
          });
          await ctx.runMutation(internal.scheduledPosts.syncCampaignStatusFromPosts, {
            campaignId: post.campaignId,
          });
          return;
        }
        const accessToken = tokenResult.accessToken;

        const result = mediaType === "image"
          ? await uploadPhotoToTikTok({
              accessToken,
              imageUrl: resolvedAssetUrl,
              caption: post.caption,
              settings: tiktokSettings,
            })
          : await uploadVideoToTikTok({
              accessToken,
              videoUrl: resolvedAssetUrl,
              caption: post.caption,
              settings: tiktokSettings,
            });

        if (result.success && result.publishId) {
          await ctx.runMutation(internal.scheduledPosts.updatePostAfterPublish, {
            postId: args.postId,
            status: "publishing",
            platformPostId: result.publishId,
            mediaType,
          });
          console.log(`[publishScheduledPost] TikTok publish initialized (${mediaType}): ${result.publishId}`);

          await ctx.scheduler.runAfter(60 * 1000, internal.scheduledPosts.checkTikTokPublishCompletion, {
            postId: args.postId,
            attempt: 0,
          });
        } else {
          if (retryCount < maxRetries) {
            const delay = Math.pow(2, retryCount) * 60000;
            console.log(`[publishScheduledPost] Upload failed, retrying in ${delay}ms (attempt ${retryCount + 1})`);
            await ctx.scheduler.runAt(Date.now() + delay, internal.scheduledPosts.publishScheduledPost, {
              postId: args.postId,
              retryCount: retryCount + 1,
            });
          } else {
            await ctx.runMutation(internal.scheduledPosts.updatePostAfterPublish, {
              postId: args.postId,
              status: "failed",
              error: result.error || "Failed to upload to TikTok after retries",
            });

            await ctx.runMutation(internal.scheduledPosts.createPostNotification, {
              brandId: post.brandId,
              campaignId: post.campaignId,
              type: "post_failed",
              title: "Post Failed",
              message: result.error || "Your campaign post failed to publish to TikTok.",
            });

            await ctx.runMutation(internal.scheduledPosts.syncCampaignStatusFromPosts, {
              campaignId: post.campaignId,
            });
          }
        }
      } else {
        await ctx.runMutation(internal.scheduledPosts.updatePostAfterPublish, {
          postId: args.postId,
          status: "failed",
          error: `Unsupported platform: ${post.platform}`,
        });
      }
    } catch (error) {
      console.error(`[publishScheduledPost] Error publishing post ${args.postId}:`, error);

      if (retryCount < maxRetries) {
        const delay = Math.pow(2, retryCount) * 60000;
        console.log(`[publishScheduledPost] Exception, retrying in ${delay}ms (attempt ${retryCount + 1})`);
        await ctx.scheduler.runAt(Date.now() + delay, internal.scheduledPosts.publishScheduledPost, {
          postId: args.postId,
          retryCount: retryCount + 1,
        });
      } else {
        await ctx.runMutation(internal.scheduledPosts.updatePostAfterPublish, {
          postId: args.postId,
          status: "failed",
          error: error instanceof Error ? error.message : "Unknown error after 3 retries",
        });

        await ctx.runMutation(internal.scheduledPosts.createPostNotification, {
          brandId: post.brandId,
          campaignId: post.campaignId,
          type: "post_failed",
          title: "Post Failed",
          message: "Your campaign post failed to publish. Please check your TikTok connection and try again.",
        });

        await ctx.runMutation(internal.scheduledPosts.syncCampaignStatusFromPosts, {
          campaignId: post.campaignId,
        });
      }
    }
  },
});

export const checkTikTokPublishCompletion = internalAction({
  args: {
    postId: v.id("scheduledPosts"),
    attempt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const attempt = args.attempt ?? 0;
    const maxAttempts = 12;

    const data = await ctx.runQuery(internal.scheduledPosts.getPostForPublishing, {
      postId: args.postId,
    });
    if (!data?.post) return;

    const { post, connection } = data;
    if (post.status !== "publishing") return;
    if (!post.platformPostId) {
      await ctx.runMutation(internal.scheduledPosts.updatePostAfterPublish, {
        postId: args.postId,
        status: "failed",
        error: "TikTok publish was initialized without a publish id.",
      });
      await ctx.runMutation(internal.scheduledPosts.syncCampaignStatusFromPosts, {
        campaignId: post.campaignId,
      });
      return;
    }
    if (!connection?.accessToken) {
      await ctx.runMutation(internal.scheduledPosts.updatePostAfterPublish, {
        postId: args.postId,
        status: "failed",
        error: "No active TikTok connection found while checking publish status.",
      });
      await ctx.runMutation(internal.scheduledPosts.syncCampaignStatusFromPosts, {
        campaignId: post.campaignId,
      });
      return;
    }

    const tokenResult = await ctx.runAction(internal.platformConnections.ensureFreshTikTokAccessToken, {
      brandId: post.brandId,
    });
    if ("error" in tokenResult) {
      // Don't fail the post here - it may already be published on TikTok's side.
      // Just skip this status check; the next attempt will retry once the
      // merchant reconnects.
      console.warn(`[checkTikTokPublishCompletion] Token refresh failed (${tokenResult.error}); skipping check.`);
      return;
    }

    const result = await checkPublishStatus(tokenResult.accessToken, post.platformPostId);
    const status = result.status;

    if (status === "PUBLISH_COMPLETE") {
      await ctx.runMutation(internal.scheduledPosts.updatePostAfterPublish, {
        postId: args.postId,
        status: "posted",
        postedAt: Date.now(),
      });
      console.log(`[TikTok] Publish complete for post ${args.postId}: ${post.platformPostId}`);

      await ctx.runMutation(internal.scheduledPosts.createPostNotification, {
        brandId: post.brandId,
        campaignId: post.campaignId,
        type: "post_published",
        title: "Post Published",
        message: "Your campaign post has been published to TikTok",
      });

      await ctx.runMutation(internal.scheduledPosts.syncCampaignStatusFromPosts, {
        campaignId: post.campaignId,
      });

      const mediaType = post.mediaType ?? await ctx.runQuery(internal.scheduledPosts.resolvePostMediaType, {
        postId: args.postId,
      });
      if (mediaType !== "image") {
        await ctx.scheduler.runAfter(60 * 1000, internal.scheduledPosts.syncSinglePostAnalytics, {
          postId: args.postId,
        });
      }
      return;
    }

    if (status === "FAILED" || status === "PUBLISH_FAILED") {
      await ctx.runMutation(internal.scheduledPosts.updatePostAfterPublish, {
        postId: args.postId,
        status: "failed",
        error: result.error || `TikTok publish failed (${status})`,
      });

      await ctx.runMutation(internal.scheduledPosts.createPostNotification, {
        brandId: post.brandId,
        campaignId: post.campaignId,
        type: "post_failed",
        title: "Post Failed",
        message: result.error || "Your campaign post failed to publish to TikTok.",
      });

      await ctx.runMutation(internal.scheduledPosts.syncCampaignStatusFromPosts, {
        campaignId: post.campaignId,
      });
      return;
    }

    if (attempt < maxAttempts) {
      await ctx.scheduler.runAfter(60 * 1000, internal.scheduledPosts.checkTikTokPublishCompletion, {
        postId: args.postId,
        attempt: attempt + 1,
      });
      return;
    }

    await ctx.runMutation(internal.scheduledPosts.updatePostAfterPublish, {
      postId: args.postId,
      status: "failed",
      error: result.error
        ? `TikTok publish status check failed after ${maxAttempts + 1} checks: ${result.error}`
        : `TikTok did not confirm publish completion after ${maxAttempts + 1} checks. Last status: ${status}.`,
    });
    await ctx.runMutation(internal.scheduledPosts.syncCampaignStatusFromPosts, {
      campaignId: post.campaignId,
    });
  },
});

// ─── getTikTokCreatorInfo ────────────────────────────────────────────────────
// Fetches live creator capabilities from TikTok (available privacy levels, feature toggles).

export const getTikTokCreatorInfo: any = action({
  args: { brandId: v.id("brands") },
  handler: async (ctx, args) => {
    const connection = await ctx.runQuery(internal.platformConnections.getConnectionInternal, {
      brandId: args.brandId,
      platform: "tiktok",
    });

    if (!connection) {
      return { error: "No TikTok connection found" };
    }

    const tokenResult = await ctx.runAction(internal.platformConnections.ensureFreshTikTokAccessToken, {
      brandId: args.brandId,
    });
    if ("error" in tokenResult) {
      return {
        error: tokenResult.error === "refresh_token_invalid" || tokenResult.error === "no_refresh_token"
          ? "TikTok connection expired - please reconnect TikTok."
          : `TikTok token refresh failed: ${tokenResult.error}`,
      };
    }

    const result = await queryCreatorInfo(tokenResult.accessToken);
    return result;
  },
});

// ─── suggestSchedule ─────────────────────────────────────────────────────────
// AI suggests optimal posting times based on industry, platforms, and video count.

export const suggestSchedule = action({
  args: {
    industry: v.optional(v.string()),
    timezone: v.optional(v.string()),
    videoCount: v.number(),
    platforms: v.array(v.string()),
    brandTone: v.optional(v.string()),
    targetAudience: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const billing = await ctx.runMutation(internal.billing.reserveSkuOperationInternal, {
      userId: String(userId),
      featureKey: "helper_ai",
      skuKey: "text.scheduling_suggestions",
      units: 1,
      metadata: { source: "campaign_schedule_suggestions", videoCount: args.videoCount },
    });
    const { createOpenRouter } = await import("@openrouter/ai-sdk-provider");
    const { generateObject } = await import("ai");
    const { z } = await import("zod");

    const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
    if (!OPENROUTER_API_KEY) {
      await ctx.runMutation(internal.billing.releaseReservationInternal, {
        reservationId: billing.reservationId,
        userId: String(userId),
        skuKey: "text.scheduling_suggestions",
        reason: "OPENROUTER_API_KEY not configured",
      });
      return generateFallbackSchedule(args.videoCount, args.platforms);
    }

    try {
      const openrouter = createOpenRouter({ apiKey: OPENROUTER_API_KEY });
      const model = openrouter("openai/gpt-4o-mini");

    const now = new Date();
    const startDate = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const dayOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][startDate.getDay()];

    const result = await generateObject({
      model,
      schema: z.object({
        schedule: z.array(z.object({
          videoIndex: z.number().describe("0-indexed video number"),
          platform: z.string(),
          date: z.string().describe("YYYY-MM-DD format"),
          time: z.string().describe("HH:MM in 24h format"),
        })),
      }),
      system: `You are a senior social media strategist and paid media planner who has managed content calendars and ad rollouts for over 500 brands across TikTok, Instagram, Facebook, YouTube, and Snapchat. You have deep knowledge of platform-specific algorithm behavior, audience attention patterns, and engagement timing data.

Your scheduling decisions are data-driven:
- You understand that different demographics are active at different times (Gen Z scrolls late evening, parents scroll during school hours, professionals scroll during commute and lunch)
- You know that platform algorithms reward consistent posting cadence over bursts
- You know that posting frequency affects reach - too close together cannibalizes your own content, too far apart loses momentum
- You factor in day-of-week patterns: weekdays vs weekends perform differently by industry
- You consider time zones and local behavior patterns`,
      prompt: `Schedule ${args.videoCount} video ad${args.videoCount !== 1 ? 's' : ''} across ${args.platforms.join(', ')} for maximum engagement.

BRAND: ${args.industry || 'consumer'} brand, tone: ${args.brandTone || 'professional'}
AUDIENCE: ${args.targetAudience || 'general consumers'}
TIMEZONE: ${args.timezone || 'UTC'}
TODAY: ${now.toISOString().split('T')[0]} (${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][now.getDay()]})
EARLIEST POST: ${startDate.toISOString().split('T')[0]} (${dayOfWeek})

The brand is launching this campaign now - schedule posts starting soon but not all at once.
Each video gets one post per platform = ${args.videoCount * args.platforms.length} total entries.
Use natural-feeling times (e.g. 18:42, not 18:00).

Use your expertise to decide optimal spacing, cadence, days, and times for this specific brand and audience on ${args.platforms.join('/')}.`,
    });

      await ctx.runMutation(internal.billing.chargeReservationInternal, {
        reservationId: billing.reservationId,
        userId: String(userId),
        skuKey: "text.scheduling_suggestions",
        reason: "Charged for campaign schedule suggestions",
      });
      return result.object.schedule;
    } catch (error) {
      await ctx.runMutation(internal.billing.releaseReservationInternal, {
        reservationId: billing.reservationId,
        userId: String(userId),
        skuKey: "text.scheduling_suggestions",
        reason: error instanceof Error ? error.message : "Schedule suggestion failed",
      });
      throw error;
    }
  },
});

function generateFallbackSchedule(videoCount: number, platforms: string[]) {
  const schedule: Array<{ videoIndex: number; platform: string; date: string; time: string }> = [];
  const start = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const times = ['18:00', '12:00', '19:00', '10:00', '17:00', '20:00'];

  for (let i = 0; i < videoCount; i++) {
    const postDate = new Date(start.getTime() + i * 2 * 24 * 60 * 60 * 1000); // every 2 days
    for (const platform of platforms) {
      schedule.push({
        videoIndex: i,
        platform,
        date: postDate.toISOString().split('T')[0],
        time: times[i % times.length],
      });
    }
  }
  return schedule;
}

// ─── batchCreateScheduledPosts ───────────────────────────────────────────────

export const batchCreateScheduledPosts = mutation({
  args: {
    campaignId: v.id("campaigns"),
    posts: v.array(v.object({
      platform: v.string(),
      assetUrl: v.string(),
      mediaType: v.optional(v.string()),
      caption: v.string(),
      scheduledAt: v.number(),
      taskId: v.optional(v.id("agentTasks")),
      angleId: v.optional(v.string()),
      tiktokSettings: v.optional(v.object({
        privacyLevel: v.optional(v.union(
          v.literal("PUBLIC_TO_EVERYONE"),
          v.literal("MUTUAL_FOLLOW_FRIENDS"),
          v.literal("FOLLOWER_OF_CREATOR"),
          v.literal("SELF_ONLY"),
        )),
        disableComment: v.optional(v.boolean()),
        disableDuet: v.optional(v.boolean()),
        disableStitch: v.optional(v.boolean()),
        contentDisclosureEnabled: v.optional(v.boolean()),
        brandOrganicToggle: v.optional(v.boolean()),
        brandContentToggle: v.optional(v.boolean()),
        coverTimestampMs: v.optional(v.number()),
      })),
    })),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("unauthenticated");

    const campaign = await ctx.db.get(args.campaignId);
    if (!campaign) throw new Error("campaign not found");

    const brand = await ctx.db.get(campaign.brandId);
    if (!brand || brand.userId !== userId) throw new Error("not authorized");

    // Validate platform connections exist before scheduling
    const platforms = [...new Set(args.posts.map(p => p.platform))];
    for (const platform of platforms) {
      const connection = await ctx.db
        .query("platformConnections")
        .withIndex("by_brandId_platform", (q) =>
          q.eq("brandId", campaign.brandId).eq("platform", platform)
        )
        .filter((q) => q.eq(q.field("isActive"), true))
        .first();
      if (!connection) {
        throw new Error(`No ${platform} account connected. Please connect your ${platform} account in Settings before scheduling.`);
      }
    }

    const postIds: string[] = [];

    for (const post of args.posts) {
      if (post.platform === "tiktok") {
        const policyError = validateTikTokDisclosureSettings(post.tiktokSettings);
        if (policyError) throw new Error(policyError);
      }
      const postId = await ctx.db.insert("scheduledPosts", {
        campaignId: args.campaignId,
        brandId: campaign.brandId,
        taskId: post.taskId,
        angleId: post.angleId,
        platform: post.platform,
        assetUrl: post.assetUrl,
        mediaType: post.mediaType,
        caption: post.caption,
        scheduledAt: post.scheduledAt,
        status: "scheduled",
        tiktokSettings: post.platform === 'tiktok' ? post.tiktokSettings : undefined,
        createdAt: Date.now(),
      });

      // Schedule publish at the designated time
      if (post.scheduledAt <= Date.now()) {
        await ctx.scheduler.runAfter(0, internal.scheduledPosts.publishScheduledPost, { postId });
      } else {
        await ctx.scheduler.runAt(post.scheduledAt, internal.scheduledPosts.publishScheduledPost, { postId });
      }

      postIds.push(postId);
    }

    return postIds;
  },
});

// ─── reschedulePost ──────────────────────────────────────────────────────────

export const reschedulePost = mutation({
  args: {
    postId: v.id("scheduledPosts"),
    newScheduledAt: v.number(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("unauthenticated");

    const post = await ctx.db.get(args.postId);
    if (!post) throw new Error("post not found");
    if (post.status !== "scheduled") throw new Error("can only reschedule scheduled posts");

    const brand = await ctx.db.get(post.brandId);
    if (!brand || brand.userId !== userId) throw new Error("not authorized");

    await ctx.db.patch(args.postId, {
      scheduledAt: args.newScheduledAt,
    });

    // Schedule new publish action at the new time
    if (args.newScheduledAt <= Date.now()) {
      await ctx.scheduler.runAfter(0, internal.scheduledPosts.publishScheduledPost, { postId: args.postId });
    } else {
      await ctx.scheduler.runAt(args.newScheduledAt, internal.scheduledPosts.publishScheduledPost, { postId: args.postId });
    }

    return args.postId;
  },
});

// ─── retryFailedPost ─────────────────────────────────────────────────────────
// User-triggered retry for a post that failed to publish. Resets the
// post to "scheduled" with an immediate publish-time and re-enqueues
// publishScheduledPost. Clears the previous error so the UI shows a
// fresh attempt rather than a stale failure message.

export const retryFailedPost = mutation({
  args: { postId: v.id("scheduledPosts") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("unauthenticated");

    const post = await ctx.db.get(args.postId);
    if (!post) throw new Error("post not found");
    if (post.status !== "failed") {
      throw new Error(`can only retry failed posts (current status: ${post.status})`);
    }

    const brand = await ctx.db.get(post.brandId);
    if (!brand || brand.userId !== userId) throw new Error("not authorized");

    const now = Date.now();
    await ctx.db.patch(args.postId, {
      status: "scheduled",
      scheduledAt: now,
      error: undefined,
    });

    await ctx.scheduler.runAfter(0, internal.scheduledPosts.publishScheduledPost, {
      postId: args.postId,
    });

    return args.postId;
  },
});

// ─── Analytics Sync ─────────────────────────────────────────────────────────
// Adaptive polling: aggressive for fresh posts, relaxed for older ones.
//   < 24h old → sync every 15 min (cron fires every 15 min, skip-guard handles throttle)
//   1-7 days  → sync every 1 hour
//   7-30 days → sync every 6 hours
//   > 30 days → stop syncing

export const syncPostAnalytics = internalAction({
  args: {},
  handler: async (ctx) => {
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;

    const posts = await ctx.runQuery(internal.scheduledPosts.listPostedPostsForAnalytics, {
      since: thirtyDaysAgo,
    });

    let synced = 0;
    let skipped = 0;
    // Cache one refresh per brand for the duration of this sync pass.
    const tokenByBrand = new Map<string, string | null>();

    for (const post of posts) {
      if (post.mediaType === "image") {
        skipped++;
        continue;
      }
      if (!post.platformPostId || !post.connection?.accessToken) {
        skipped++;
        continue;
      }

      // Adaptive throttle based on post age
      const ageMs = Date.now() - (post.postedAt || post.createdAt);
      const ageHours = ageMs / (1000 * 60 * 60);
      let minInterval: number;
      if (ageHours < 24) minInterval = 15 * 60 * 1000;        // 15 min for first 24h
      else if (ageHours < 168) minInterval = 60 * 60 * 1000;   // 1 hour for 1-7 days
      else minInterval = 6 * 60 * 60 * 1000;                    // 6 hours for 7-30 days

      if (post.analytics?.lastSyncedAt && Date.now() - post.analytics.lastSyncedAt < minInterval) {
        skipped++;
        continue;
      }

      const brandKey = String(post.brandId);
      if (!tokenByBrand.has(brandKey)) {
        const tokenResult = await ctx.runAction(internal.platformConnections.ensureFreshTikTokAccessToken, {
          brandId: post.brandId,
        });
        tokenByBrand.set(brandKey, "error" in tokenResult ? null : tokenResult.accessToken);
      }
      const accessToken = tokenByBrand.get(brandKey);
      if (!accessToken) {
        skipped++;
        continue;
      }

      const stats = await getVideoAnalytics(
        accessToken,
        post.platformPostId,
        post.connection.grantedScopes,
      );

      if (!stats.error) {
        await ctx.runMutation(internal.scheduledPosts.updatePostAnalytics, {
          postId: post._id,
          analytics: {
            views: stats.views,
            likes: stats.likes,
            comments: stats.comments,
            shares: stats.shares,
            lastSyncedAt: Date.now(),
          },
        });
        synced++;
      } else {
        console.error(`[Analytics] Failed for post ${post._id}: ${stats.error}`);
        skipped++;
      }

      // Rate limit: 100ms between API calls
      await new Promise(r => setTimeout(r, 100));
    }

    console.log(`[Analytics] Synced ${synced} posts, skipped ${skipped}`);
  },
});

export const listPostedPostsForAnalytics = internalQuery({
  args: { since: v.number() },
  handler: async (ctx, args) => {
    const posts = await ctx.db
      .query("scheduledPosts")
      .filter((q) =>
        q.and(
          q.eq(q.field("status"), "posted"),
          q.gte(q.field("postedAt"), args.since)
        )
      )
      .collect();

    // Enrich with platform connection for access token
    const enriched = await Promise.all(
      posts.map(async (post) => {
        const connection = await ctx.db
          .query("platformConnections")
          .withIndex("by_brandId_platform", (q) =>
            q.eq("brandId", post.brandId).eq("platform", post.platform)
          )
          .filter((q) => q.eq(q.field("isActive"), true))
          .first();
        return { ...post, connection };
      })
    );

    return enriched;
  },
});

// Fetch analytics for a single post - used for first fetch after posting
export const syncSinglePostAnalytics = internalAction({
  args: { postId: v.id("scheduledPosts") },
  handler: async (ctx, args) => {
    const data = await ctx.runQuery(internal.scheduledPosts.getPostForPublishing, {
      postId: args.postId,
    });

    if (!data?.post || data.post.status !== "posted" || !data.post.platformPostId) return;
    if (data.post.mediaType === "image") return;
    if (!data.connection?.accessToken) return;

    const tokenResult = await ctx.runAction(internal.platformConnections.ensureFreshTikTokAccessToken, {
      brandId: data.post.brandId,
    });
    if ("error" in tokenResult) {
      console.warn(`[Analytics] First sync skipped - token refresh failed: ${tokenResult.error}`);
      return;
    }

    const stats = await getVideoAnalytics(
      tokenResult.accessToken,
      data.post.platformPostId,
      data.connection.grantedScopes,
    );

    if (!stats.error) {
      await ctx.runMutation(internal.scheduledPosts.updatePostAnalytics, {
        postId: args.postId,
        analytics: {
          views: stats.views,
          likes: stats.likes,
          comments: stats.comments,
          shares: stats.shares,
          lastSyncedAt: Date.now(),
        },
      });
      console.log(`[Analytics] First sync for post ${args.postId}: ${stats.views} views`);
    } else {
      console.error(`[Analytics] First sync failed for post ${args.postId}: ${stats.error}`);
    }
  },
});

// Manual sync - triggered by user clicking "Sync now" on campaign performance card
export const syncCampaignAnalytics: any = action({
  args: { campaignId: v.id("campaigns") },
  handler: async (ctx, args) => {
    const posts = await ctx.runQuery(internal.scheduledPosts.listPostedByCampaign, {
      campaignId: args.campaignId,
    });

    let synced = 0;
    // Bucket failures by reason so the UI can render a meaningful toast
    // ("3 posts published privately, sandbox mode") instead of a bare
    // "Synced 0 of 3" count that hides the root cause.
    let privatePostCount = 0;
    let otherErrorCount = 0;
    const tokenByBrand = new Map<string, string | null>();
    for (const post of posts) {
      if (post.mediaType === "image") continue;
      if (!post.platformPostId || !post.connection?.accessToken) continue;

      const brandKey = String(post.brandId);
      if (!tokenByBrand.has(brandKey)) {
        const tokenResult = await ctx.runAction(internal.platformConnections.ensureFreshTikTokAccessToken, {
          brandId: post.brandId,
        });
        tokenByBrand.set(brandKey, "error" in tokenResult ? null : tokenResult.accessToken);
      }
      const accessToken = tokenByBrand.get(brandKey);
      if (!accessToken) {
        otherErrorCount++;
        continue;
      }

      const stats = await getVideoAnalytics(
        accessToken,
        post.platformPostId,
        post.connection.grantedScopes,
      );
      if (!stats.error) {
        await ctx.runMutation(internal.scheduledPosts.updatePostAnalytics, {
          postId: post._id,
          analytics: {
            views: stats.views,
            likes: stats.likes,
            comments: stats.comments,
            shares: stats.shares,
            lastSyncedAt: Date.now(),
          },
        });
        synced++;
      } else if (stats.error === "private_post_no_analytics") {
        privatePostCount++;
        console.warn(`[Analytics] Post ${post._id} is private (sandbox/SELF_ONLY), no analytics available`);
      } else {
        otherErrorCount++;
        console.error(`[Analytics] Manual sync failed for post ${post._id}: ${stats.error}`);
      }
    }
    return {
      synced,
      total: posts.length,
      privatePostCount,
      otherErrorCount,
    };
  },
});

// Internal query for copilot tool - returns posts by brand with campaign names enriched
export const listPostsByBrandWithCampaignNames = internalQuery({
  args: { brandId: v.id("brands") },
  handler: async (ctx, args) => {
    const posts = await ctx.db
      .query("scheduledPosts")
      .withIndex("by_brandId", (q) => q.eq("brandId", args.brandId))
      .collect();

    const campaignCache: Record<string, string> = {};
    const enriched = await Promise.all(posts.map(async (p) => {
      if (!campaignCache[p.campaignId]) {
        const c = await ctx.db.get(p.campaignId);
        campaignCache[p.campaignId] = c?.name || "Unknown";
      }
      return { ...p, campaignName: campaignCache[p.campaignId] };
    }));
    return enriched;
  },
});

export const listPostedByCampaign = internalQuery({
  args: { campaignId: v.id("campaigns") },
  handler: async (ctx, args) => {
    const posts = await ctx.db
      .query("scheduledPosts")
      .withIndex("by_campaignId", (q) => q.eq("campaignId", args.campaignId))
      .filter((q) => q.eq(q.field("status"), "posted"))
      .collect();

    const enriched = await Promise.all(
      posts.map(async (post) => {
        const connection = await ctx.db
          .query("platformConnections")
          .withIndex("by_brandId_platform", (q) =>
            q.eq("brandId", post.brandId).eq("platform", post.platform)
          )
          .filter((q) => q.eq(q.field("isActive"), true))
          .first();
        return { ...post, connection };
      })
    );
    return enriched;
  },
});

export const updatePostAnalytics = internalMutation({
  args: {
    postId: v.id("scheduledPosts"),
    analytics: v.object({
      views: v.number(),
      likes: v.number(),
      comments: v.number(),
      shares: v.number(),
      lastSyncedAt: v.number(),
    }),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.postId, { analytics: args.analytics });
  },
});

function looksLikeImageUrl(url: string): boolean {
  try {
    const path = new URL(url).pathname.toLowerCase();
    return /\.(png|jpe?g|webp|gif|avif|heic|heif)$/.test(path);
  } catch {
    return /\.(png|jpe?g|webp|gif|avif|heic|heif)(\?|#|$)/i.test(url);
  }
}


// admin schema
export const getAllBrandScheduledPosts = query({
  args: {},
  handler: async (ctx) => {
    const teamMember = await getCurrentTeamMember(ctx);
        if (!teamMember) {
      throw new Error("unauthenticated");
    }
    return await ctx.db.query("scheduledPosts").collect();
  },
});
