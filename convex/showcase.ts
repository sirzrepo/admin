import { action, mutation, query } from "./_generated/server";
import { api } from "./_generated/api";
import { v } from "convex/values";
import { requireWorkspaceMember } from "./workspace";

const MAX_FIELD_LENGTH = 500;

function cleanText(value: string, field: string) {
  const text = value.trim().replace(/[^\S\n]+/g, " ");
  if (!text || text.length > MAX_FIELD_LENGTH) {
    throw new Error(`${field} must be between 1 and ${MAX_FIELD_LENGTH} characters`);
  }
  return text;
}

function validateImageUrl(value: string) {
  const url = value.trim();
  if (!/^https:\/\//.test(url) || url.length > 2048) {
    throw new Error("Image URL must be a valid https:// URL");
  }
  return url;
}

/**
 * Public list of published showcase items, ordered by sortOrder.
 * No auth guard - consumed by the marketing website (app/showcase).
 */
export const listPublished = query({
  args: {},
  handler: async (ctx) => {
    return ctx.db
      .query("showcaseItems")
      .withIndex("by_published_sortOrder", (q) => q.eq("isPublished", true))
      .order("asc")
      .collect();
  },
});

/** Admin: full list, ordered by sortOrder. */
export const listAll = query({
  args: {},
  handler: async (ctx) => {
    await requireWorkspaceMember(ctx);
    return ctx.db.query("showcaseItems").withIndex("by_sortOrder").collect();
  },
});

/** Admin: create a showcase item, appended at the end of the wall. */
export const createItem = mutation({
  args: {
    title: v.string(),
    tag: v.string(),
    caption: v.string(),
    imageUrl: v.optional(v.union(v.string(), v.null())),
    isPublished: v.optional(v.boolean()),
    categoryId: v.optional(v.id("showcaseCategories")),
    videoUrl: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    await requireWorkspaceMember(ctx);
    if (args.categoryId !== undefined) {
      const category = await ctx.db.get(args.categoryId);
      if (!category) throw new Error("Category not found");
    }
    const imageUrl = args.imageUrl ?? null;
    const videoUrl = args.videoUrl ?? null;
    if (imageUrl !== null && !imageUrl) throw new Error("Invalid image URL");
    if (videoUrl !== null && !videoUrl) throw new Error("Invalid video URL");
    if (imageUrl === null && videoUrl === null) {
      throw new Error("Provide an image or a video");
    }
    const last = await ctx.db.query("showcaseItems").withIndex("by_sortOrder").order("desc").first();
    const now = Date.now();
    return ctx.db.insert("showcaseItems", {
      title: cleanText(args.title, "Title"),
      tag: cleanText(args.tag, "Tag"),
      caption: cleanText(args.caption, "Caption"),
      imageUrl: imageUrl === null ? null : validateImageUrl(imageUrl),
      videoUrl: videoUrl === null ? null : validateImageUrl(videoUrl),
      categoryId: args.categoryId ?? null,
      sortOrder: (last?.sortOrder ?? -1) + 1,
      isPublished: args.isPublished ?? true,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/** Admin: update a showcase item's fields and/or publish state. */
export const updateItem = mutation({
  args: {
    itemId: v.id("showcaseItems"),
    title: v.optional(v.string()),
    tag: v.optional(v.string()),
    caption: v.optional(v.string()),
    imageUrl: v.optional(v.union(v.string(), v.null())),
    isPublished: v.optional(v.boolean()),
    categoryId: v.optional(v.union(v.id("showcaseCategories"), v.null())),
    videoUrl: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    await requireWorkspaceMember(ctx);
    const item = await ctx.db.get(args.itemId);
    if (!item) throw new Error("Showcase item not found");
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.title !== undefined) patch.title = cleanText(args.title, "Title");
    if (args.tag !== undefined) patch.tag = cleanText(args.tag, "Tag");
    if (args.caption !== undefined) patch.caption = cleanText(args.caption, "Caption");
    if (args.imageUrl !== undefined) {
      patch.imageUrl = args.imageUrl === null ? null : validateImageUrl(args.imageUrl);
    }
    if (args.isPublished !== undefined) patch.isPublished = args.isPublished;
    if (args.categoryId !== undefined) {
      if (args.categoryId !== null) {
        const category = await ctx.db.get(args.categoryId);
        if (!category) throw new Error("Category not found");
      }
      patch.categoryId = args.categoryId;
    }
    if (args.videoUrl !== undefined) {
      patch.videoUrl =
        args.videoUrl === null ? null : validateImageUrl(args.videoUrl);
    }
    await ctx.db.patch(args.itemId, patch);
    return args.itemId;
  },
});

/** Admin: delete a showcase item. The R2 object is left in place (fixed-key overwrite pattern). */
export const deleteItem = mutation({
  args: { itemId: v.id("showcaseItems") },
  handler: async (ctx, args) => {
    await requireWorkspaceMember(ctx);
    const item = await ctx.db.get(args.itemId);
    if (!item) return false;
    await ctx.db.delete(args.itemId);
    return true;
  },
});

/** Admin: reorder the wall by passing item ids in their new order. */
export const reorderItems = mutation({
  args: { orderedIds: v.array(v.id("showcaseItems")) },
  handler: async (ctx, args) => {
    await requireWorkspaceMember(ctx);
    if (!args.orderedIds.length) return [];
    const items = await ctx.db.query("showcaseItems").collect();
    const byId = new Map(items.map((item) => [item._id, item]));
    const invalid = args.orderedIds.find((id) => !byId.has(id));
    if (invalid) throw new Error("Unknown showcase item");
    if (args.orderedIds.length !== items.length) {
      throw new Error("Reorder payload does not include every item");
    }
    const now = Date.now();
    for (const [index, id] of args.orderedIds.entries()) {
      await ctx.db.patch(id, { sortOrder: index, updatedAt: now });
    }
    return args.orderedIds;
  },
});

const R2_PUBLIC_BASE = "https://pub-1f5cd68cca10472e9224eff87e49d3fb.r2.dev";

function safeStorageName(fileName: string) {
  const safeName = fileName
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-");
  if (!safeName || safeName.length > 120) {
    throw new Error("Invalid file name");
  }
  return safeName;
}

/**
 * Admin: issue a Convex storage upload URL. The browser uploads the file
 * straight to Convex storage (CORS-enabled, like the @investors data room),
 * then commitUpload moves it into the R2 showcase bucket server-side.
 */
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireWorkspaceMember(ctx);
    return ctx.storage.generateUploadUrl();
  },
});

/** Admin: move a freshly uploaded file from Convex storage into the R2 showcase bucket. */
export const commitUpload = action({
  args: {
    storageId: v.id("_storage"),
    fileName: v.string(),
    contentType: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.runQuery(api.workspace.currentMember, {});
    const key = `showcase/${safeStorageName(args.fileName)}`;

    const accountId = process.env.CF_ACCOUNT_ID;
    const bucketName = process.env.CF_R2_BUCKET;
    const accessKeyId = process.env.CF_R2_ACCESS_KEY_ID;
    const secretAccessKey = process.env.CF_R2_SECRET_ACCESS_KEY;
    if (!accountId || !bucketName || !accessKeyId || !secretAccessKey) {
      throw new Error("Storage configuration error");
    }

    const blob = await ctx.storage.get(args.storageId);
    if (!blob) {
      throw new Error("Uploaded file not found");
    }

    const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");
    const s3 = new S3Client({
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
      // Don't let the SDK inject x-amz-checksum-crc32 headers - R2 rejects them.
      requestChecksumCalculation: "WHEN_REQUIRED",
    });

    await s3.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: key,
        Body: blob,
        ContentType: args.contentType,
      }),
    );
    await ctx.storage.delete(args.storageId);

    return { publicUrl: `${R2_PUBLIC_BASE}/${key}` };
  },
});
