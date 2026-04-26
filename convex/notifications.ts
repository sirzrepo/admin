import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { Id } from "./_generated/dataModel";

// Get notifications for a user
export const getUserNotifications = query({
  args: {
    userId: v.string(),
    unreadOnly: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    let notifications;
    
    if (args.unreadOnly === true) {
      notifications = await ctx.db
        .query("notifications")
        .withIndex("by_userId_read", (q) => 
          q.eq("userId", args.userId).eq("read", false)
        )
        .collect();
    } else {
      notifications = await ctx.db
        .query("notifications")
        .withIndex("by_userId", (q) => q.eq("userId", args.userId))
        .collect();
    }

    notifications.sort((a, b) => b.createdAt - a.createdAt);

    let result = notifications;
    if (args.limit) {
      result = notifications.slice(0, args.limit);
    }

    return result;
  },
});

// Get notifications for a brand
export const getBrandNotifications = query({
  args: {
    brandId: v.id("brands"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const notifications = await ctx.db
      .query("notifications")
      .withIndex("by_brandId", (q) => q.eq("brandId", args.brandId))
      .collect();

    notifications.sort((a, b) => b.createdAt - a.createdAt);

    let result = notifications;
    if (args.limit) {
      result = notifications.slice(0, args.limit);
    }

    return result;
  },
});

// Get a single notification by ID
export const getNotification = query({
  args: { notificationId: v.id("notifications") },
  handler: async (ctx, args) => {
    const notification = await ctx.db.get(args.notificationId);
    return notification;
  },
});

// Get unread notification count for a user
export const getUnreadNotificationCount = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const notifications = await ctx.db
      .query("notifications")
      .withIndex("by_userId_read", (q) => 
        q.eq("userId", args.userId).eq("read", false)
      )
      .collect();

    return notifications.length;
  },
});

// Create a new notification
export const createNotification = mutation({
  args: {
    userId: v.string(),
    brandId: v.id("brands"),
    type: v.string(),
    title: v.string(),
    message: v.string(),
    taskId: v.optional(v.id("agentTasks")),
    link: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const notificationId = await ctx.db.insert("notifications", {
      userId: args.userId,
      brandId: args.brandId,
      type: args.type,
      title: args.title,
      message: args.message,
      taskId: args.taskId,
      link: args.link,
      read: false,
      createdAt: Date.now(),
    });

    return notificationId;
  },
});

// Mark notification as read
export const markNotificationAsRead = mutation({
  args: { notificationId: v.id("notifications") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const notification = await ctx.db.get(args.notificationId);
    if (!notification) throw new Error("Notification not found");

    // Verify user owns the notification
    if (notification.userId !== userId) {
      throw new Error("Not authorized to mark this notification as read");
    }

    await ctx.db.patch(args.notificationId, { read: true });
    return args.notificationId;
  },
});

// Mark all notifications as read for a user
export const markAllNotificationsAsRead = mutation({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const authUserId = await getAuthUserId(ctx);
    if (!authUserId) throw new Error("Not authenticated");

    // Verify user is marking their own notifications
    if (authUserId !== args.userId) {
      throw new Error("Not authorized to mark notifications for this user");
    }

    const notifications = await ctx.db
      .query("notifications")
      .withIndex("by_userId_read", (q) => 
        q.eq("userId", args.userId).eq("read", false)
      )
      .collect();

    // Mark all as read
    for (const notification of notifications) {
      await ctx.db.patch(notification._id, { read: true });
    }

    return notifications.length;
  },
});

// Delete notification
export const deleteNotification = mutation({
  args: { notificationId: v.id("notifications") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const notification = await ctx.db.get(args.notificationId);
    if (!notification) throw new Error("Notification not found");

    // Verify user owns the notification
    if (notification.userId !== userId) {
      throw new Error("Not authorized to delete this notification");
    }

    await ctx.db.delete(args.notificationId);
    return args.notificationId;
  },
});

// Delete all read notifications for a user
export const deleteReadNotifications = mutation({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const authUserId = await getAuthUserId(ctx);
    if (!authUserId) throw new Error("Not authenticated");

    // Verify user is deleting their own notifications
    if (authUserId !== args.userId) {
      throw new Error("Not authorized to delete notifications for this user");
    }

    const notifications = await ctx.db
      .query("notifications")
      .withIndex("by_userId_read", (q) => 
        q.eq("userId", args.userId).eq("read", true)
      )
      .collect();

    // Delete all read notifications
    for (const notification of notifications) {
      await ctx.db.delete(notification._id);
    }

    return notifications.length;
  },
});

// Create task completed notification (helper function)
export const createTaskCompletedNotification = mutation({
  args: {
    userId: v.string(),
    brandId: v.id("brands"),
    taskId: v.id("agentTasks"),
    taskType: v.string(),
    link: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const notificationId = await ctx.db.insert("notifications", {
      userId: args.userId,
      brandId: args.brandId,
      type: "task_completed",
      title: "Task Completed",
      message: `Your ${args.taskType} task has been completed successfully.`,
      taskId: args.taskId,
      link: args.link,
      read: false,
      createdAt: Date.now(),
    });

    return notificationId;
  },
});

// Create task failed notification (helper function)
export const createTaskFailedNotification = mutation({
  args: {
    userId: v.string(),
    brandId: v.id("brands"),
    taskId: v.id("agentTasks"),
    taskType: v.string(),
    errorMessage: v.string(),
    link: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const notificationId = await ctx.db.insert("notifications", {
      userId: args.userId,
      brandId: args.brandId,
      type: "task_failed",
      title: "Task Failed",
      message: `Your ${args.taskType} task failed: ${args.errorMessage}`,
      taskId: args.taskId,
      link: args.link,
      read: false,
      createdAt: Date.now(),
    });

    return notificationId;
  },
});
