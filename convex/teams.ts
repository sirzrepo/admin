import { createAccount } from "@convex-dev/auth/server";
import { getAuthenticatedMember, getTeamMemberById } from "./helpers";
import { ConvexError, v } from "convex/values";
import { filter } from "convex-helpers/server/filter";
import { paginationOptsValidator } from "convex/server";
import { getRoleByMemberId, linkTeamRole } from "./helpers";
import { Doc } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";


// Get the authenticated user
export const authenticated = query({
    args: {},
    handler: async (ctx) => {
        return await getAuthenticatedMember(ctx)
    },
});

export const getCurrentMember = query({
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    return identity;
  },
});


export const syncMemberFromClerk = mutation({
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    console.log("identity****************", identity)
    if (!identity) throw new Error("Unauthorized");

    const clerkId = identity.subject;
    const userEmail = identity.email;

    if (!userEmail) {
      throw new ConvexError("Email is required from authentication provider");
    }

    const existing = await ctx.db
      .query("teams")
      .withIndex("by_clerkId", (q) =>
        q.eq("clerkId", clerkId)
      )
      .first();

    const latestData = {
      email: userEmail,
      name: identity.name ?? undefined,
      image: identity.pictureUrl ?? undefined,
    };

    // 🟢 If user doesn't exist → check invite and create
    if (!existing) {
      // Check if user has an invite with a role
      const invite = await ctx.db
        .query("invites")
        .withIndex("by_email", (q) => q.eq("email", userEmail))
        .first();

      if (!invite) {
        throw new ConvexError("No invitation found for this email address");
      }

      if (!invite.role) {
        throw new ConvexError("Invitation does not include a role assignment");
      }

      // Create the user
      const userId = await ctx.db.insert("teams", {
        clerkId,
        ...latestData,
      });

      // Link the user to the role from the invite
      await linkTeamRole(ctx, userId, invite.role);

      // Update invite status to accepted
      await ctx.db.patch(invite._id, { status: "accepted" });

      return;
    }

    // 🟡 If user exists → update only if something changed
    const needsUpdate =
      existing.email !== latestData.email ||
      existing.name !== latestData.name ||
      existing.image !== latestData.image;

    if (needsUpdate) {
      await ctx.db.patch(existing._id, latestData);
    }
  },
});

// Get a paginated teams list.
export const list = query({
    args: {
        searchQuery: v.optional(v.string()),
        email: v.optional(v.string()),
        paginationOpts: paginationOptsValidator
    },
    handler: async (ctx, args) => {
        const { email, searchQuery, paginationOpts } = args

        const query = ctx.db.query('teams')

        const results = await filter(
            query,
            (user) => {
                const emailCheck = email
                    ? user.email === email
                    : true
                const searchCheck = searchQuery
                    ? (user.email ? user.email.includes(searchQuery) : false)
                    || (user.name ? user.name.includes(searchQuery) : false)
                    || (user.phone ? user.phone.includes(searchQuery) : false)
                    : true

                return emailCheck && searchCheck;
            }
        )
            .order('desc')
            .paginate(paginationOpts)

        const transformations = await Promise.all(results.page.map(async (user) => {
            const role = await getRoleByMemberId(ctx, user._id)
            return {
                roleName: role?.name,
                status: user.isActive ? "active" : "inactive",
                lastActive: 'Never',
                dateJoined: new Date(user._creationTime).toLocaleDateString(),
                image: user.image,
            }
        }))

        const transformedResults = {
            ...results,
            page: results.page.map((user, index) => ({
                ...user,
                ...transformations[index]
            }))
        }

        // console.log('transformations', transformations);
        // console.log('transformedResults', transformedResults);

        return transformedResults
    },
});

export const deactivate = mutation({
    args: { id: v.id("teams") },
    handler: async (ctx, args) => {
        const { id } = args

        // Deactivate user.
        await ctx.db.patch(id, {
            isActive: false
        });
    },
});

export const updateRole = mutation({
    args: { 
        id: v.id("teams"),
        roleName: v.string()
    },
    handler: async (ctx, args) => {
        const { id, roleName } = args

        // Link user to new role.
        await linkTeamRole(ctx, id, roleName);
    },
});

// Update user profile information (all fields except email)
export const updateProfile = mutation({
    args: {
        id: v.id("teams"),
        name: v.optional(v.string()),
        image: v.optional(v.string()),
        phone: v.optional(v.string()),
        phoneVerificationTime: v.optional(v.number()),
        bio: v.optional(v.string()),
        referralCode: v.optional(v.string()),
        verified: v.optional(v.boolean()),
        isActive: v.optional(v.boolean()),
    },
    handler: async (ctx, args): Promise<Doc<"teams"> | null> => {
        const { id, ...updates } = args;

        // Get user to update
        const user = await getTeamMemberById(ctx, id);
        if (!user) {
            throw new ConvexError("User not found.");
        }

        // Update the user with all provided fields
        await ctx.db.patch(id, updates);
        
        return await getTeamMemberById(ctx, id);
    },
});


// Get a user by ID
export const getById = query({
    args: {
        id: v.id("teams")
    },
    handler: async (ctx, args) => {
        return await getTeamMemberById(ctx, args.id);
    },
});

// Get multiple teams by their IDs
export const getTeamsByIds = query({
    args: {
        userIds: v.array(v.id("teams"))
    },
    handler: async (ctx, args) => {
        const teams = await Promise.all(
            args.userIds.map(userId => ctx.db.get(userId))
        );
        return teams.filter(Boolean);
    },
});

// Get a user by email address
export const getUserByEmail = mutation({
    args: {
        email: v.string()
    },
    handler: async (ctx, args) => {
        const { email } = args;
        
        // Find the user with the given email
        const user = await ctx.db
            .query("teams")
            .withIndex("email", q => q.eq("email", email))
            .first();
            
        return user;
    },
});

// Check if user is authorized to access the system
export const checkUserAuthorization = query({
    args: {},
    handler: async (ctx) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity || !identity.email) {
            return { authorized: false, reason: "Not authenticated" };
        }

        // Get the Convex user
        const user = await ctx.db
            .query("teams")
            .withIndex("by_clerkId", q => q.eq("clerkId", identity.subject))
            .unique();

        if (!user) {
            return { authorized: false, reason: "User not found in database" };
        }
        // Check if user has an accepted invite
        const invite = await ctx.db
            .query("invites")
            .withIndex("by_email", q => q.eq("email", identity.email!))
            .filter(q => q.eq(q.field("status"), "accepted"))
            .first();

        if (!invite) {
            return { authorized: false, reason: "No accepted invitation found" };
        }

        // Check if user has a role assigned (from invite)
        if (!invite.role) {
            return { authorized: false, reason: "No role assigned to user" };
        }

        return { authorized: true };
    },
});


