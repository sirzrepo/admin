/**
 * Website workspace team management ("Made with SIRz" wall admins).
 *
 * Mirrors the investor workspace's team invitation flow:
 *   1. An owner/admin invites an email from /admin/members.
 *   2. The invitee signs in at sirz.ai/admin and verifies the six-digit code.
 *   3. The auth callback + `ensureMembership` activate them as a workspace member.
 *
 * All workspace + showcase functions are gated through `requireWorkspaceMember`,
 * which accepts active workspace members as well as legacy admin-role / allowlisted
 * users so existing sessions keep working.
 */

import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { action, mutation, query, QueryCtx, MutationCtx } from "./_generated/server";
import { api } from "./_generated/api";
import { isInternalAdminEmail } from "./adminAuth";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const WEBSITE_URL = process.env.WEBSITE_URL || "https://sirz.ai";

function normalizeEmail(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export async function requireWorkspaceMember(ctx: QueryCtx | MutationCtx) {
  const userId = await getAuthUserId(ctx);
  if (userId === null) throw new Error("Not authenticated");
  const user = await ctx.db.get(userId);
  if (!user) throw new Error("Not authenticated");

  const email = normalizeEmail(user.email);
  if (!email) throw new Error("Workspace access required");

  const member = await ctx.db
    .query("workspaceMembers")
    .withIndex("by_email", (q) => q.eq("email", email))
    .first();

  if (member?.status === "active") return { user, member };

  // Legacy access: allowlisted owners / admin-role users who signed in before the
  // invitations feature. Synthesize an owner member so the storefront UI works
  // until the next verification persists a real row (via `ensureMembership`).
  if (!member && (user.role === "admin" || isInternalAdminEmail(email))) {
    return {
      user,
      member: {
        _id: userId,
        userId,
        email,
        name: user.name || email,
        role: "owner" as const,
        status: "active" as const,
        invitedAt: 0,
      },
    };
  }

  throw new Error("Workspace access required");
}

/**
 * Idempotent activation/repair of the current user's workspace membership.
 * Called by the admin layout right after sign-in.
 */
export const ensureMembership = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return { allowed: false };
    const user = await ctx.db.get(userId);
    if (!user) return { allowed: false };
    const email = normalizeEmail(user.email);
    const now = Date.now();
    if (!email) return { allowed: false };

    const isOwner = isInternalAdminEmail(email);
    const existing = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();

    if (existing?.status === "active") {
      if (existing.userId !== userId) await ctx.db.patch(existing._id, { userId });
      if (isOwner && existing.role !== "owner") await ctx.db.patch(existing._id, { role: "owner" });
      return { allowed: true };
    }

    const invitation = (await ctx.db
      .query("workspaceInvitations")
      .withIndex("by_email", (q) => q.eq("email", email))
      .collect())
      .find((item) => !item.acceptedAt && !item.revokedAt && item.expiresAt > now);

    const grant = isOwner || Boolean(invitation);
    if (!grant) return { allowed: false };

    if (existing) {
      await ctx.db.patch(existing._id, {
        userId,
        name: invitation?.name || existing.name,
        role: isOwner ? "owner" : (invitation!.role),
        status: "active",
        invitedBy: invitation?.invitedBy,
        invitedAt: invitation?._creationTime ?? now,
        joinedAt: now,
        suspendedAt: undefined,
      });
    } else {
      await ctx.db.insert("workspaceMembers", {
        userId,
        email,
        name: invitation?.name || user.name || email,
        role: isOwner ? "owner" : invitation!.role,
        status: "active",
        invitedBy: invitation?.invitedBy,
        invitedAt: invitation?._creationTime ?? now,
        joinedAt: now,
      });
    }
    if (invitation) await ctx.db.patch(invitation._id, { acceptedAt: now });
    return { allowed: true };
  },
});

/** Current workspace member (owner/admin or legacy allowed admin). */
export const currentMember = query({
  args: {},
  handler: async (ctx) => {
    const { member } = await requireWorkspaceMember(ctx);
    return member;
  },
});

/** All workspace members, newest first. Requires workspace access. */
export const listMembers = query({
  args: {},
  handler: async (ctx) => {
    await requireWorkspaceMember(ctx);
    const members = await ctx.db.query("workspaceMembers").order("desc").collect();
    return members;
  },
});

/** Pending (not yet accepted/revoked) invitations, newest first. */
export const listInvitations = query({
  args: {},
  handler: async (ctx) => {
    await requireWorkspaceMember(ctx);
    const invitations = await ctx.db.query("workspaceInvitations").order("desc").collect();
    return invitations.filter((item) => !item.acceptedAt && !item.revokedAt);
  },
});

/** Revoke a pending invitation so the address can no longer sign in. */
export const revokeInvitation = mutation({
  args: { id: v.id("workspaceInvitations") },
  handler: async (ctx, args) => {
    await requireWorkspaceMember(ctx);
    const invitation = await ctx.db.get(args.id);
    if (!invitation || invitation.acceptedAt || invitation.revokedAt) return;
    await ctx.db.patch(args.id, { revokedAt: Date.now() });
  },
});

/**
 * Create (or refresh) a pending invitation. Requires workspace access so
 * any current workspace member equals the owner can invite.
 */
export const createInvitation = mutation({
  args: {
    email: v.string(),
    name: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireWorkspaceMember(ctx);
    const email = normalizeEmail(args.email);
    if (!email) throw new Error("An email address is required");

    const now = Date.now();
    const existingMember = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_email", (q) => q.eq("email", email))
      .first();
    if (existingMember?.status === "active") {
      throw new Error("This person already has workspace access");
    }

    const existingInvitation = (await ctx.db
      .query("workspaceInvitations")
      .withIndex("by_email", (q) => q.eq("email", email))
      .collect()).find((item) => !item.acceptedAt && !item.revokedAt);

    if (existingInvitation) {
      await ctx.db.patch(existingInvitation._id, {
        name: args.name,
        expiresAt: now + INVITE_TTL_MS,
      });
      return existingInvitation._id;
    }

    return ctx.db.insert("workspaceInvitations", {
      email,
      name: args.name,
      role: "admin",
      tokenHash: crypto.randomUUID(),
      invitedBy: (await getAuthUserId(ctx))!,
      expiresAt: now + INVITE_TTL_MS,
    });
  },
});

/** Invite a new workspace admin and email them. Requires workspace access. */
export const inviteMember = action({
  args: {
    email: v.string(),
    name: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<boolean> => {
    const email = normalizeEmail(args.email);
    if (!email) throw new Error("An email is required");

    await ctx.runMutation(api.workspace.createInvitation, { email, name: args.name });

    const from = process.env.AUTH_EMAIL_FROM || "SIRz <noreply@breezepost.app>";
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.AUTH_RESEND_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: email,
        subject: "You're invited to the SIRz website workspace",
        html: `<p>You have been invited to help manage the SIRz website (“Made with SIRz” wall) and other site settings.</p><p><a href="${WEBSITE_URL}/admin">Open the SIRz website workspace and sign in →</a></p><p>Use this email address to receive your six-digit sign-in code. The invitation expires in 7 days.</p>`,
        text: `You've been invited to the SIRz website workspace. Sign in at ${WEBSITE_URL}/admin with this email to receive a six-digit sign-in code.`,
      }),
    });
    if (!res.ok) {
      console.error("Resend invite delivery failed", await res.text());
      throw new Error("Invitation created but the email could not be sent");
    }
    return true;
  },
});

/** Suspend or restore a workspace member (owner excluded). Requires workspace access. */
export const setMemberStatus = mutation({
  args: {
    id: v.id("workspaceMembers"),
    status: v.union(v.literal("suspended"), v.literal("active")),
  },
  handler: async (ctx, args) => {
    const { member } = await requireWorkspaceMember(ctx);
    const target = await ctx.db.get(args.id);
    if (!target) throw new Error("Member not found");
    if (member.role !== "owner" && (target.role === "owner")) {
      throw new Error("Only the workspace owner can manage other owners");
    }
    if (target.userId === member.userId && args.status === "suspended") {
      throw new Error("You can't suspend yourself");
    }
    await ctx.db.patch(args.id, {
      status: args.status,
      suspendedAt: args.status === "suspended" ? Date.now() : undefined,
    });
  },
});