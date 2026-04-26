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
    const now = Date.now();
    const inviteId = await ctx.db.insert("invites", {
      email: args.email,
      token,
      role: args.role || "user",
      status: "pending",
      invitedBy: adminId,
      invitedAt: now,
      expiresAt: now + (3 * 24 * 60 * 60 * 1000), // 3 days from now
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

// Get invite by token
export const getInviteByToken = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const invite = await ctx.db
      .query("invites")
      .withIndex("by_token_email", (q) => q.eq("token", args.token))
      .first();

    if (!invite) {
      return null;
    }

    // Check if invite is expired using expiresAt field
    const now = Date.now();
    if (invite.expiresAt && now > invite.expiresAt || invite.status === "expired") {
      return { ...invite, valid: false, reason: "Invite has expired" };
    }

    // Check if invite has already been used
    if (invite.status === "accepted") {
      return { ...invite, valid: false, reason: "Invite has already been used" };
    }

    // Check if invite is pending
    if (invite.status !== "pending") {
      return { ...invite, valid: false, reason: "Invite is not valid" };
    }

    return { ...invite, valid: true, reason: "Invite is valid" };
  },
});

// Check if an invite is valid for a given email
export const validateInvite = query({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    // Find the invite by email
    const invite = await ctx.db
      .query("invites")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .first();

    if (!invite) {
      return { valid: false, reason: "No invite found for this email" };
    }

    // Check if invite is expired using expiresAt field
    const now = Date.now();
    if (invite.expiresAt && now > invite.expiresAt || invite.status === "expired") {
      return { valid: false, reason: "Invite has expired" };
    }

    // Check if invite has already been used
    if (invite.status === "accepted") {
      return { valid: false, reason: "Invite has already been used" };
    }

    // Check if invite is pending
    if (invite.status !== "pending") {
      return { valid: false, reason: "Invite is not valid" };
    }

    return { 
      valid: true, 
      role: invite.role,
      reason: "Invite is valid" 
    };
  },
});

// Internal mutation to expire old invites (can be called by a scheduled function)
export const expireOldInvites = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();

    const oldInvites = await ctx.db
      .query("invites")
      .filter((q) => q.lt(q.field("expiresAt"), now))
      .filter((q) => q.eq(q.field("status"), "pending"))
      .collect();

    for (const invite of oldInvites) {
      await ctx.db.patch(invite._id, { status: "expired" });
    }
  },
});
