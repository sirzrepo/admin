import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { filter } from "convex-helpers/server/filter";
import { Resend as ResendAPI } from "resend";
import { mutation, query } from "./_generated/server";
import { api } from "./_generated/api";

// Create a new invite
export const create = mutation({
    args: {
        email: v.string(),
        role: v.string(),
    },
    handler: async (ctx, args) => {
        const token = crypto.randomUUID();
        const expiresAt = Date.now() + 1000 * 60 * 60 * 24 * 3; // 3 days
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) throw new Error("Not authenticated");

        // Get the Convex user ID
        const teamMember = await ctx.db
          .query("teams")
          .withIndex("by_clerkId", q => q.eq("clerkId", identity.subject))
          .unique();
    
        if (!teamMember) {
          throw new Error("teamMember not found in database");
        }

        const inviteId = await ctx.db.insert("invites", {
            ...args,
            token,
            status: "pending",
            expiresAt,
            invitedBy: teamMember._id,
        });
        await ctx.scheduler.runAfter(
          0,
          api.emailTemplates.index.sendInviteEmail,
          {
            email: args.email,
            token,
            invitedBy: teamMember.name || identity.email || "Unknown",
            expiresAt,
          }
        );

        return {
            inviteId,
            token,
        };
    },
});


// Accept an invitation using a token
export const acceptInvitation = mutation({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();

    if (!identity) {
      throw new Error("Unauthorized");
    }

    // Get the Convex user ID
    const teamMember = await ctx.db
      .query("teams")
      .withIndex("by_clerkId", q => q.eq("clerkId", identity.subject))
      .unique();

    if (!teamMember) {
      throw new Error("teamMember not found in database");
    }

    const invite = await ctx.db
      .query("invites")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .unique();

    if (!invite) {
      throw new Error("Invite not found");
    }

    // if (invite.status !== "pending") {
    //   throw new Error("Invite already used");
    // }

    if (invite.expiresAt < Date.now()) {
      throw new Error("Invite expired");
    }

    // OPTIONAL: Ensure same email as invite
    if (identity.email !== invite.email) {
      throw new Error("This invite was sent to a different email");
    }

    // Mark invite as accepted
    await ctx.db.patch(invite._id, {
      status: "accepted",
    });

    return { success: true };
  },
});






// Get paginated list of invites
export const list = query({
    args: {
        status: v.optional(v.union(
            v.literal("pending"),
            v.literal("accepted"),
            v.literal("expired")
        )),
        paginationOpts: paginationOptsValidator,
    },
    handler: async (ctx, args) => {
        const { status, paginationOpts } = args;

        if (status) {
            return await ctx.db.query("invites")
                .withIndex("by_status", q => q.eq("status", status))
                .order('desc')
                .paginate(paginationOpts);
        }

        return await ctx.db.query("invites")
            .order('desc')
            .paginate(paginationOpts);
    },
});

// Get invite by token
export const getByToken = query({
    args: { token: v.string() },
    handler: async (ctx, args) => {
        return await ctx.db
            .query("invites")
            .withIndex("by_token", q => q.eq("token", args.token))
            .unique();
    },
});

// Validate invite token
export const validateToken = query({
    args: { token: v.string() },
    handler: async (ctx, args) => {
        const invite = await ctx.db
            .query("invites")
            .withIndex("by_token", q => q.eq("token", args.token))
            .unique();

        if (!invite) {
            return {
                valid: false,
                reason: "Invalid invitation token",
                requiresAuth: false,
            };
        }

        if (invite.expiresAt < Date.now()) {
            return {
                valid: false,
                reason: "Invitation has expired",
                requiresAuth: false,
            };
        }

        if (invite.status !== "pending") {
            return {
                valid: false,
                reason: "Invitation already used",
                requiresAuth: false,
            };
        }

        // Get inviter member info
        const inviter = await ctx.db.get(invite.invitedBy);

        return {
            valid: true,
            requiresAuth: true,
            invite: {
                id: invite._id,
                email: invite.email,
                role: invite.role,
                invitedBy: inviter?.name || inviter?.email || "Unknown",
            },
        };
    },
});

// Update invite status
export const updateStatus = mutation({
    args: {
        id: v.id("invites"),
        status: v.union(
            v.literal("pending"),
            v.literal("accepted"),
            v.literal("expired")
        ),
    },
    handler: async (ctx, args) => {
        const { id, status } = args;
        return await ctx.db.patch(id, { status });
    },
});
