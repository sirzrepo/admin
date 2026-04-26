import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { Id } from "./_generated/dataModel";

// Get scheduled posts for a campaign
export const getScheduledPosts = query({
  args: {
    campaignId: v.id("campaigns"),
    status: v.optional(v.string()),
    platform: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let posts = await ctx.db
      .query("scheduledPosts")
      .withIndex("by_campaignId", (q) => q.eq("campaignId", args.campaignId))
      .collect();

    if (args.status) {
      posts = posts.filter(post => post.status === args.status);
    }

    if (args.platform) {
      posts = posts.filter(post => post.platform === args.platform);
    }

    return posts.sort((a, b) => b.scheduledAt - a.scheduledAt);
  },
});

// Get scheduled posts for a brand
export const getBrandScheduledPosts = query({
  args: {
    brandId: v.id("brands"),
    status: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    let posts = await ctx.db
      .query("scheduledPosts")
      .withIndex("by_brandId", (q) => q.eq("brandId", args.brandId))
      .collect();

    if (args.status) {
      posts = posts.filter(post => post.status === args.status);
    }

    posts.sort((a, b) => b.scheduledAt - a.scheduledAt);

    if (args.limit) {
      posts = posts.slice(0, args.limit);
    }

    return posts;
  },
});

// Get posts scheduled for a specific time range
export const getUpcomingScheduledPosts = query({
  args: {
    brandId: v.id("brands"),
    fromTime: v.number(),
    toTime: v.number(),
    status: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let posts = await ctx.db
      .query("scheduledPosts")
      .withIndex("by_brandId", (q) => q.eq("brandId", args.brandId))
      .collect();

    posts = posts.filter(post => 
      post.scheduledAt >= args.fromTime && 
      post.scheduledAt <= args.toTime
    );

    if (args.status) {
      posts = posts.filter(post => post.status === args.status);
    }

    return posts.sort((a, b) => a.scheduledAt - b.scheduledAt);
  },
});

// Get a single scheduled post by ID
export const getScheduledPost = query({
  args: { postId: v.id("scheduledPosts") },
  handler: async (ctx, args) => {
    const post = await ctx.db.get(args.postId);
    return post;
  },
});

// Create a new scheduled post
export const createScheduledPost = mutation({
  args: {
    campaignId: v.id("campaigns"),
    brandId: v.id("brands"),
    taskId: v.optional(v.id("agentTasks")),
    angleId: v.optional(v.string()),
    platform: v.string(),
    assetUrl: v.string(),
    caption: v.string(),
    scheduledAt: v.number(),
    tiktokSettings: v.optional(v.object({
      privacyLevel: v.optional(v.string()),
      disableComment: v.optional(v.boolean()),
      disableDuet: v.optional(v.boolean()),
      disableStitch: v.optional(v.boolean()),
      coverTimestampMs: v.optional(v.number()),
    })),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    // Verify user owns the brand
    const brand = await ctx.db.get(args.brandId);
    if (!brand || brand.userId !== userId) {
      throw new Error("Not authorized to schedule posts for this brand");
    }

    // Verify campaign belongs to the brand
    const campaign = await ctx.db.get(args.campaignId);
    if (!campaign || campaign.brandId !== args.brandId) {
      throw new Error("Campaign does not belong to this brand");
    }

    // Check if scheduled time is in the future
    if (args.scheduledAt <= Date.now()) {
      throw new Error("Scheduled time must be in the future");
    }

    const postId = await ctx.db.insert("scheduledPosts", {
      campaignId: args.campaignId,
      brandId: args.brandId,
      taskId: args.taskId,
      angleId: args.angleId,
      platform: args.platform,
      assetUrl: args.assetUrl,
      caption: args.caption,
      scheduledAt: args.scheduledAt,
      postedAt: undefined,
      status: "scheduled",
      tiktokSettings: args.tiktokSettings,
      platformPostId: undefined,
      error: undefined,
      analytics: undefined,
      createdAt: Date.now(),
    });

    return postId;
  },
});

// Update scheduled post
export const updateScheduledPost = mutation({
  args: {
    postId: v.id("scheduledPosts"),
    assetUrl: v.optional(v.string()),
    caption: v.optional(v.string()),
    scheduledAt: v.optional(v.number()),
    tiktokSettings: v.optional(v.object({
      privacyLevel: v.optional(v.string()),
      disableComment: v.optional(v.boolean()),
      disableDuet: v.optional(v.boolean()),
      disableStitch: v.optional(v.boolean()),
      coverTimestampMs: v.optional(v.number()),
    })),
    status: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const post = await ctx.db.get(args.postId);
    if (!post) throw new Error("Post not found");

    // Verify user owns the brand
    const brand = await ctx.db.get(post.brandId);
    if (!brand || brand.userId !== userId) {
      throw new Error("Not authorized to update this post");
    }

    // Prevent editing posts that are already posted
    if (post.status === "posted") {
      throw new Error("Cannot update a post that has already been posted");
    }

    const updateData: any = {};
    if (args.assetUrl !== undefined) updateData.assetUrl = args.assetUrl;
    if (args.caption !== undefined) updateData.caption = args.caption;
    if (args.scheduledAt !== undefined) {
      if (args.scheduledAt <= Date.now()) {
        throw new Error("Scheduled time must be in the future");
      }
      updateData.scheduledAt = args.scheduledAt;
    }
    if (args.tiktokSettings !== undefined) updateData.tiktokSettings = args.tiktokSettings;
    if (args.status !== undefined) updateData.status = args.status;

    await ctx.db.patch(args.postId, updateData);
    return args.postId;
  },
});

// Mark post as posted
export const markPostAsPosted = mutation({
  args: {
    postId: v.id("scheduledPosts"),
    platformPostId: v.string(),
  },
  handler: async (ctx, args) => {
    const post = await ctx.db.get(args.postId);
    if (!post) throw new Error("Post not found");

    await ctx.db.patch(args.postId, {
      status: "posted",
      postedAt: Date.now(),
      platformPostId: args.platformPostId,
    });

    return args.postId;
  },
});

// Mark post as failed
export const markPostAsFailed = mutation({
  args: {
    postId: v.id("scheduledPosts"),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const post = await ctx.db.get(args.postId);
    if (!post) throw new Error("Post not found");

    await ctx.db.patch(args.postId, {
      status: "failed",
      error: args.error,
    });

    return args.postId;
  },
});

// Update post analytics
export const updatePostAnalytics = mutation({
  args: {
    postId: v.id("scheduledPosts"),
    views: v.number(),
    likes: v.number(),
    comments: v.number(),
    shares: v.number(),
  },
  handler: async (ctx, args) => {
    const post = await ctx.db.get(args.postId);
    if (!post) throw new Error("Post not found");

    await ctx.db.patch(args.postId, {
      analytics: {
        views: args.views,
        likes: args.likes,
        comments: args.comments,
        shares: args.shares,
        lastSyncedAt: Date.now(),
      },
    });

    return args.postId;
  },
});

// Delete scheduled post
export const deleteScheduledPost = mutation({
  args: { postId: v.id("scheduledPosts") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const post = await ctx.db.get(args.postId);
    if (!post) throw new Error("Post not found");

    // Verify user owns the brand
    const brand = await ctx.db.get(post.brandId);
    if (!brand || brand.userId !== userId) {
      throw new Error("Not authorized to delete this post");
    }

    // Prevent deleting posts that are already posted
    if (post.status === "posted") {
      throw new Error("Cannot delete a post that has already been posted");
    }

    await ctx.db.delete(args.postId);
    return args.postId;
  },
});

// Reschedule post
export const reschedulePost = mutation({
  args: {
    postId: v.id("scheduledPosts"),
    newScheduledAt: v.number(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const post = await ctx.db.get(args.postId);
    if (!post) throw new Error("Post not found");

    // Verify user owns the brand
    const brand = await ctx.db.get(post.brandId);
    if (!brand || brand.userId !== userId) {
      throw new Error("Not authorized to reschedule this post");
    }

    // Prevent rescheduling posts that are already posted
    if (post.status === "posted") {
      throw new Error("Cannot reschedule a post that has already been posted");
    }

    if (args.newScheduledAt <= Date.now()) {
      throw new Error("New scheduled time must be in the future");
    }

    await ctx.db.patch(args.postId, {
      scheduledAt: args.newScheduledAt,
      status: "scheduled",
      error: undefined,
    });

    return args.postId;
  },
});
