import { internalMutation, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { api } from "./_generated/api";

// Generate a random token for invites
function generateInviteToken() {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

// Admin creates an invite for a staff member
export const createInvite = mutation({
  args: {
    email: v.string(),
    role: v.optional(v.union(v.literal("admin"), v.literal("user"))),
  },
  handler: async (ctx, args) => {
    const adminId = await getAuthUserId(ctx);
    if (!adminId) throw new Error("unauthenticated");

    // Check if user is admin
    const admin = await ctx.db.get(adminId);
    if (!admin || admin.role !== "admin") {
      throw new Error("unauthorized: only admins can create invites");
    }

    // Check if invite already exists for this email
    const existingInvite = await ctx.db
      .query("invites")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .first();

    if (existingInvite) {
      throw new Error("invite already exists for this email");
    }

    const token = generateInviteToken();
    const inviteId = await ctx.db.insert("invites", {
      email: args.email,
      token,
      role: args.role || "user",
      status: "pending",
      invitedBy: adminId,
      invitedAt: Date.now(),
    });

    return inviteId;
  },
});

// Get all pending invites (admin only)
export const getInvites = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const user = await ctx.db.get(userId);
    if (!user || user.role !== "admin") {
      return [];
    }

    return await ctx.db.query("invites").collect();
  },
});

// User accepts an invite using the token
export const acceptInvite = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("unauthenticated");

    // Find the invite by token
    const invite = await ctx.db
      .query("invites")
      .withIndex("by_token_email", (q) => q.eq("token", args.token))
      .first();

    if (!invite) {
      throw new Error("invalid invite token");
    }

    if (invite.status !== "pending") {
      throw new Error("invite has already been used or expired");
    }

    // Update user role
    await ctx.db.patch(userId, {
      role: invite.role,
    });

    // Mark invite as accepted
    await ctx.db.patch(invite._id, {
      status: "accepted",
    });

    return invite.role;
  },
});

// Internal mutation to expire old invites (can be called by a scheduled function)
export const expireOldInvites = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000; // 7 days ago

    const oldInvites = await ctx.db
      .query("invites")
      .filter((q) => q.lt(q.field("invitedAt"), cutoff))
      .filter((q) => q.eq(q.field("status"), "pending"))
      .collect();

    for (const invite of oldInvites) {
      await ctx.db.patch(invite._id, { status: "expired" });
    }
  },
});
