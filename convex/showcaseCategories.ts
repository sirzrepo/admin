import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireWorkspaceMember } from "./workspace";

const MAX_NAME_LENGTH = 60;

function cleanName(value: string) {
  const name = value.trim().replace(/\s+/g, " ");
  if (!name || name.length > MAX_NAME_LENGTH) {
    throw new Error(`Category name must be between 1 and ${MAX_NAME_LENGTH} characters`);
  }
  return name;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/**
 * Public: ordered list of wall categories. No auth guard - consumed by the
 * marketing site (app/showcase) to render its filter tabs.
 */
export const list = query({
  args: {},
  handler: async (ctx) => {
    return ctx.db.query("showcaseCategories").withIndex("by_sortOrder").collect();
  },
});

/** Admin: create a category, appended at the end of the wall filter list. */
export const create = mutation({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    await requireWorkspaceMember(ctx);
    const name = cleanName(args.name);
    const slug = slugify(name);
    const existing = await ctx.db
      .query("showcaseCategories")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
    if (existing) throw new Error("A category with this name already exists");
    const last = await ctx.db
      .query("showcaseCategories")
      .withIndex("by_sortOrder")
      .order("desc")
      .first();
    const now = Date.now();
    return ctx.db.insert("showcaseCategories", {
      name,
      slug,
      sortOrder: (last?.sortOrder ?? -1) + 1,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/** Admin: rename a category. The slug stays stable as the identifier. */
export const update = mutation({
  args: { categoryId: v.id("showcaseCategories"), name: v.string() },
  handler: async (ctx, args) => {
    await requireWorkspaceMember(ctx);
    const category = await ctx.db.get(args.categoryId);
    if (!category) throw new Error("Category not found");
    const name = cleanName(args.name);
    const existing = await ctx.db
      .query("showcaseCategories")
      .withIndex("by_slug", (q) => q.eq("slug", slugify(name)))
      .first();
    if (existing && existing._id !== args.categoryId) {
      throw new Error("A category with this name already exists");
    }
    await ctx.db.patch(args.categoryId, { name, updatedAt: Date.now() });
    return args.categoryId;
  },
});

/**
 * Admin: delete a category and detach it from any showcase items, so items
 * fall back to "unfiltered" rather than being removed from the wall.
 */
export const remove = mutation({
  args: { categoryId: v.id("showcaseCategories") },
  handler: async (ctx, args) => {
    await requireWorkspaceMember(ctx);
    const category = await ctx.db.get(args.categoryId);
    if (!category) return false;
    const items = await ctx.db
      .query("showcaseItems")
      .withIndex("by_category", (q) => q.eq("categoryId", args.categoryId))
      .collect();
    for (const item of items) {
      await ctx.db.patch(item._id, { categoryId: null, updatedAt: Date.now() });
    }
    await ctx.db.delete(args.categoryId);
    return true;
  },
});