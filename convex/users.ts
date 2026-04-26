import { query, mutation } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";

export const getMe = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return null;
    }
    const user = await ctx.db.get(userId);
    return user;
  },
});

export const getAllUsers = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return [];
    }

    // Check if user is admin
    const user = await ctx.db.get(userId);
    if (!user || user.role !== "admin") {
      return [];
    }

    return await ctx.db.query("users").collect();
  },
});

export const updateRole = mutation({
  args: { 
    userId: v.id("users"),
    role: v.union(v.literal("admin"), v.literal("user"))
  },
  handler: async (ctx, args) => {
    const currentUserId = await getAuthUserId(ctx);
    if (!currentUserId) throw new Error("Not authenticated");
    
    // Check if current user is admin
    const currentUser = await ctx.db.get(currentUserId);
    if (!currentUser || currentUser.role !== "admin") {
      throw new Error("Only admins can update user roles");
    }
    
    // Prevent users from changing their own role
    if (currentUserId === args.userId) {
      throw new Error("Cannot change your own role");
    }
    
    await ctx.db.patch(args.userId, { role: args.role });
  }
});

export const updateName = mutation({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    
    await ctx.db.patch(userId, { name: args.name });
  }
});
