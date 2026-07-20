import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { getCurrentTeamMember } from "./helpers";

// Public query for the UI to list synced products (paginated)
export const listProducts = query({
  args: {
    brandId: v.id("brands"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("products")
      .withIndex("by_brandId", (q) => q.eq("brandId", args.brandId))
      .order("desc")
      .paginate(args.paginationOpts);
  }
});

// Paginated full-text search over products.title scoped to a brand.
// Empty query falls back to the regular paginated list so the same hook
// powers both "browse" and "search" without an extra request flip.
export const searchProducts = query({
  args: {
    brandId: v.id("brands"),
    query: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const q = args.query.trim();
    if (!q) {
      return await ctx.db
        .query("products")
        .withIndex("by_brandId", (idx) => idx.eq("brandId", args.brandId))
        .order("desc")
        .paginate(args.paginationOpts);
    }
    // Search results are relevance-ordered, not creation-ordered.
    return await ctx.db
      .query("products")
      .withSearchIndex("search_title", (s) =>
        s.search("title", q).eq("brandId", args.brandId),
      )
      .paginate(args.paginationOpts);
  },
});

// Distinct values for category / productType / vendor scoped to a brand,
// used to power autocomplete suggestions on the manual product form.
// Caps at 200 products to bound work; brands with larger catalogs still get
// a representative suggestion set without paginating.
export const getProductFacets = query({
  args: { brandId: v.id("brands") },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("products")
      .withIndex("by_brandId", (q) => q.eq("brandId", args.brandId))
      .take(200);

    const categories = new Set<string>();
    const productTypes = new Set<string>();
    const vendors = new Set<string>();
    const currencyCounts = new Map<string, number>();
    for (const r of rows) {
      if (r.category) categories.add(r.category);
      if (r.productType) productTypes.add(r.productType);
      if (r.vendor) vendors.add(r.vendor);
      const cc = r.priceRange?.currencyCode;
      if (cc) currencyCounts.set(cc, (currencyCounts.get(cc) ?? 0) + 1);
    }
    let dominantCurrency: string | undefined;
    let best = 0;
    for (const [cc, count] of currencyCounts) {
      if (count > best) {
        best = count;
        dominantCurrency = cc;
      }
    }
    return {
      categories: Array.from(categories).sort(),
      productTypes: Array.from(productTypes).sort(),
      vendors: Array.from(vendors).sort(),
      dominantCurrency,
    };
  },
});

// Non-paginated collect query used by the Brand Agent tool (agents can't use paginationOpts)
export const listProductsForAgent = query({
  args: { brandId: v.id("brands") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("products")
      .withIndex("by_brandId", (q) => q.eq("brandId", args.brandId))
      .take(50); // Cap at 50 to protect context window
  }
});

export const listProductsInternal = internalQuery({
  args: { brandId: v.id("brands") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("products")
      .withIndex("by_brandId", (q) => q.eq("brandId", args.brandId))
      .take(20);
  },
});

// Single product upsert (used by both bulk sync and webhooks)
export const upsertProduct = internalMutation({
  args: {
    brandId: v.id("brands"),
    productData: v.any(), // The Shopify GraphQL 'node' or REST webhook payload
  },
  handler: async (ctx, args) => {
    const { brandId, productData } = args;
    // GraphQL bulk sync sends `id` as "gid://shopify/Product/123", REST webhooks send a numeric id.
    // Normalise to a consistent string format.
    const rawId = productData.id;
    const shopifyProductId = typeof rawId === "string" ? rawId : `gid://shopify/Product/${rawId}`;

    // Map Shopify GraphQL response to our schema
    const title = productData.title;
    // Shopify can return null for empty descriptions - coerce to undefined so Convex optional fields are satisfied
    const description = productData.descriptionHtml || productData.body_html || undefined;
    const handle = productData.handle;
    const productType = productData.productType || productData.product_type || undefined;
    const vendor = productData.vendor || undefined;
    const status = productData.status?.toUpperCase() || "ACTIVE";
    const tags = productData.tags
      ? (Array.isArray(productData.tags) ? productData.tags : productData.tags.split(',').map((t: string) => t.trim()))
      : [];
    const imageUrl = productData.featuredImage?.url || productData.image?.src || undefined;
    const variantCount = productData.totalVariants || productData.variants?.length || 0;

    // Stock count: GraphQL provides totalInventory directly; REST webhooks require summing variant inventory_quantity
    const stockCountRaw: number | undefined = productData.totalInventory !== undefined
      ? (productData.totalInventory as number)
      : productData.variants
        ? (productData.variants as any[]).reduce((sum: number, variant: any) => sum + (variant.inventory_quantity || 0), 0)
        : undefined;

    // Category: GraphQL provides the standardized taxonomy category; REST webhooks don't include it
    const categoryRaw: string | undefined = productData.category?.name ?? undefined;

    let priceRange: { minPrice: string; maxPrice: string; currencyCode: string } | undefined;
    if (productData.priceRangeV2) {
      // GraphQL bulk sync path - priceRangeV2 has exact min/max across all variants
      priceRange = {
        minPrice: productData.priceRangeV2.minVariantPrice.amount,
        maxPrice: productData.priceRangeV2.maxVariantPrice.amount,
        currencyCode: productData.priceRangeV2.minVariantPrice.currencyCode,
      };
    } else if (productData.variants && productData.variants.length > 0) {
      // REST webhook path - compute actual min/max across all variants
      const prices: number[] = (productData.variants as any[])
        .map((v: any) => parseFloat(v.price))
        .filter((p: number) => !isNaN(p));
      if (prices.length > 0) {
        const minP = Math.min(...prices);
        const maxP = Math.max(...prices);
        // REST webhooks include a top-level `currency` field on some payloads; fall back to "USD"
        const currencyCode: string = productData.currency || "USD";
        priceRange = {
          minPrice: minP.toFixed(2),
          maxPrice: maxP.toFixed(2),
          currencyCode,
        };
      }
    }

    // Build payload without explicit `undefined` values - Convex strict types require optional
    // fields to be omitted rather than set to undefined.
    const payload = {
      brandId,
      shopifyProductId,
      title,
      description,
      handle,
      productType,
      vendor,
      status,
      tags,
      imageUrl,
      priceRange,
      variantCount,
      ...(stockCountRaw !== undefined ? { stockCount: stockCountRaw } : {}),
      ...(categoryRaw !== undefined ? { category: categoryRaw } : {}),
      syncedAt: Date.now(),
    };

    const existing = await ctx.db
      .query("products")
      .withIndex("by_shopifyId", (q) => q.eq("shopifyProductId", shopifyProductId))
      .filter((q) => q.eq(q.field("brandId"), brandId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, payload);
    } else {
      await ctx.db.insert("products", payload);
    }
  }
});

// ─── createManualProduct - user-entered product with optional image ───────────

export const createManualProduct = mutation({
  args: {
    brandId: v.id("brands"),
    title: v.string(),
    imageUrl: v.optional(v.string()),
    productType: v.optional(v.string()),
    description: v.optional(v.string()),
    vendor: v.optional(v.string()),
    category: v.optional(v.string()),
    stockCount: v.optional(v.number()),
    price: v.optional(v.string()),
    currencyCode: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("unauthenticated");

    const brand = await ctx.db.get(args.brandId);
    if (!brand || brand.userId !== userId) throw new Error("not authorized");

    const handle = args.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

    const priceRange = args.price && args.price.trim()
      ? {
          minPrice: args.price.trim(),
          maxPrice: args.price.trim(),
          currencyCode: (args.currencyCode || "USD").toUpperCase(),
        }
      : undefined;

    const productId = await ctx.db.insert("products", {
      brandId: args.brandId,
      source: "manual",
      title: args.title,
      description: args.description,
      handle,
      productType: args.productType,
      vendor: args.vendor,
      status: "ACTIVE",
      tags: [],
      imageUrl: args.imageUrl,
      priceRange,
      variantCount: 1,
      stockCount: args.stockCount,
      category: args.category,
      syncedAt: Date.now(),
    });

    return productId;
  },
});

// Public: update a manually-added product.
// Shopify-synced rows are intentionally read-only here so the next sync
// can't silently clobber a local edit; only `source === "manual"` rows
// are editable.
export const updateManualProduct = mutation({
  args: {
    productId: v.id("products"),
    title: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    productType: v.optional(v.string()),
    description: v.optional(v.string()),
    vendor: v.optional(v.string()),
    category: v.optional(v.string()),
    stockCount: v.optional(v.number()),
    price: v.optional(v.string()),
    currencyCode: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("unauthenticated");
    const product = await ctx.db.get(args.productId);
    if (!product) throw new Error("product not found");
    const brand = await ctx.db.get(product.brandId);
    if (!brand || brand.userId !== userId) throw new Error("not authorized");
    if (product.source !== "manual") throw new Error("only manual products can be edited");

    const patch: Record<string, unknown> = {};
    if (args.title !== undefined) {
      const t = args.title.trim();
      if (!t) throw new Error("title cannot be empty");
      patch.title = t;
      patch.handle = t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    }
    if (args.imageUrl !== undefined) patch.imageUrl = args.imageUrl.trim() || undefined;
    if (args.productType !== undefined) patch.productType = args.productType.trim() || undefined;
    if (args.description !== undefined) patch.description = args.description.trim() || undefined;
    if (args.vendor !== undefined) patch.vendor = args.vendor.trim() || undefined;
    if (args.category !== undefined) patch.category = args.category.trim() || undefined;
    if (args.stockCount !== undefined) {
      patch.stockCount = Number.isFinite(args.stockCount) ? args.stockCount : undefined;
    }
    // Price + currency are coupled: only patch priceRange when at least one is provided.
    if (args.price !== undefined || args.currencyCode !== undefined) {
      const price = (args.price ?? product.priceRange?.minPrice ?? "").trim();
      if (price) {
        patch.priceRange = {
          minPrice: price,
          maxPrice: price,
          currencyCode: (args.currencyCode || product.priceRange?.currencyCode || "USD").toUpperCase(),
        };
      } else {
        patch.priceRange = undefined;
      }
    }

    await ctx.db.patch(args.productId, patch);
  },
});

// Public: hard-delete a manually-added product. Shopify-synced rows must go
// through archiveProduct instead so a re-sync can naturally restore them.
export const deleteManualProduct = mutation({
  args: { productId: v.id("products") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("unauthenticated");
    const product = await ctx.db.get(args.productId);
    if (!product) throw new Error("product not found");
    const brand = await ctx.db.get(product.brandId);
    if (!brand || brand.userId !== userId) throw new Error("not authorized");
    if (product.source !== "manual") throw new Error("only manual products can be deleted");
    await ctx.db.delete(args.productId);
  },
});

// Public: archive a product (soft delete - status flip).
// Manual products created in v2 + Shopify-synced rows both go through this.
export const archiveProduct = mutation({
  args: { productId: v.id("products") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("unauthenticated");
    const product = await ctx.db.get(args.productId);
    if (!product) throw new Error("product not found");
    const brand = await ctx.db.get(product.brandId);
    if (!brand || brand.userId !== userId) throw new Error("not authorized");
    await ctx.db.patch(args.productId, { status: "ARCHIVED" });
  },
});

// Public: restore an archived product.
// For Shopify products, a later sync can still overwrite status with Shopify's
// current status. Manual products simply return to ACTIVE.
export const unarchiveProduct = mutation({
  args: { productId: v.id("products") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("unauthenticated");
    const product = await ctx.db.get(args.productId);
    if (!product) throw new Error("product not found");
    const brand = await ctx.db.get(product.brandId);
    if (!brand || brand.userId !== userId) throw new Error("not authorized");
    await ctx.db.patch(args.productId, { status: "ACTIVE" });
  },
});

export const deleteProduct = internalMutation({
  args: { shopifyProductId: v.string() },
  handler: async (ctx, { shopifyProductId }) => {
    const existing = await ctx.db
      .query("products")
      .withIndex("by_shopifyId", (q) => q.eq("shopifyProductId", shopifyProductId))
      .first();
      
    if (existing) {
      await ctx.db.delete(existing._id);
    }
  }
});

// Recount products for a brand and update the integration record
// Called after webhook create/delete events to keep the count accurate
export const refreshProductCount = internalMutation({
  args: {
    integrationId: v.id("integrations"),
    brandId: v.id("brands"),
  },
  handler: async (ctx, { integrationId, brandId }) => {
    const products = await ctx.db
      .query("products")
      .withIndex("by_brandId", (q) => q.eq("brandId", brandId))
      .collect();
    await ctx.db.patch(integrationId, { productCount: products.length });
  },
});

// Update the sync status on the integration record
export const updateSyncStatus = internalMutation({
  args: {
    integrationId: v.id("integrations"),
    status: v.string(), // "syncing" | "done" | "error"
    count: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const patch: any = { syncStatus: args.status };
    if (args.status === "done") {
      patch.lastSyncedAt = Date.now();
      if (args.count !== undefined) patch.productCount = args.count;
    }
    await ctx.db.patch(args.integrationId, patch);
  }
});

const SHOPIFY_PRODUCTS_QUERY = `
  query getProducts($cursor: String) {
    products(first: 250, after: $cursor) {
      edges {
        node {
          id
          title
          descriptionHtml
          handle
          productType
          vendor
          status
          tags
          featuredImage { url }
          priceRangeV2 {
            minVariantPrice { amount currencyCode }
            maxVariantPrice { amount currencyCode }
          }
          totalVariants
          totalInventory
          category { name }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export const syncProducts = action({
  args: {
    integrationId: v.id("integrations"),
    brandId: v.id("brands"),
    // accessToken / domain accepted for backward compatibility with existing
    // callers (frontend passes them) but ignored - we always look up the live
    // token via the integration row and refresh if expired.
    accessToken: v.optional(v.string()),
    domain: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    const { integrationId, brandId } = args;

    // Resolve a fresh access token (refreshes if near/past expiry).
    const { accessToken, domain } = await ctx.runAction(
      internal.integrations.getValidShopifyAccessToken,
      { integrationId }
    );

    // Mark as syncing
    await ctx.runMutation(internal.products.updateSyncStatus, {
      integrationId,
      status: "syncing"
    });

    try {
      console.log(`[ProductSync] Starting bulk sync for brand ${brandId} (Integration: ${integrationId})`);
      console.log(`[ProductSync] Target store domain: ${domain}`);

      let hasNextPage: boolean = true;
      let cursor: string | null = null;
      let totalSynced = 0;

      while (hasNextPage) {
        const response: Response = await fetch(`https://${domain}/admin/api/2024-04/graphql.json`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": accessToken,
          },
          body: JSON.stringify({
            query: SHOPIFY_PRODUCTS_QUERY,
            variables: { cursor }
          }),
        });

        if (!response.ok) {
          console.error(`[ProductSync] HTTP Error: ${response.status} ${response.statusText}`);
          throw new Error(`Shopify API error: ${response.statusText}`);
        }

        const data: any = await response.json();
        
        if (data.errors) {
          console.error(`[ProductSync] GraphQL Errors:`, JSON.stringify(data.errors, null, 2));
          throw new Error(`GraphQL Errors: ${JSON.stringify(data.errors)}`);
        }

        const products: any[] = data?.data?.products?.edges || [];
        console.log(`[ProductSync] Fetched ${products.length} products in this page. (Cursor: ${cursor})`);
        
        // Upsert each product using our internal mutation
        // Doing this sequentially in an action to avoid overwhelming Convex mutation limits for huge catalogs,
        // though Promise.all is faster for small batches. We'll batch them in small chunks.
        const batchSize = 25;
        for (let i = 0; i < products.length; i += batchSize) {
          const batch = products.slice(i, i + batchSize);
          console.log(`[ProductSync] Upserting batch ${i} to ${i + batch.length}...`);
          await Promise.all(batch.map((edge: any) =>
            ctx.runMutation(internal.products.upsertProduct, {
              brandId,
              productData: edge.node
            })
          ));
        }

        totalSynced += products.length;

        // Pagination
        const pageInfo: { hasNextPage: boolean; endCursor: string | null } = data?.data?.products?.pageInfo;
        hasNextPage = pageInfo?.hasNextPage || false;
        cursor = pageInfo?.endCursor || null;
      }

      console.log(`[ProductSync] Completed successfully! Total synced: ${totalSynced}`);
      // Mark as done
      await ctx.runMutation(internal.products.updateSyncStatus, {
        integrationId,
        status: "done",
        count: totalSynced
      });

      return { success: true, count: totalSynced };

    } catch (error) {
      console.error("[ProductSync] FATAL ERROR during sync:", error);
      await ctx.runMutation(internal.products.updateSyncStatus, {
        integrationId,
        status: "error"
      });
      throw error;
    }
  }
});


// Admin query to list all synced products across brands (paginated)
export const listAllProducts = query({
  args: {
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("products")
      .paginate(args.paginationOpts);
  }
});

// Create a new product (manual creation)
export const createProduct = mutation({
  args: {
    brandId: v.id("brands"),
    title: v.string(),
    description: v.optional(v.string()),
    handle: v.string(),
    productType: v.optional(v.string()),
    vendor: v.optional(v.string()),
    status: v.string(),
    tags: v.array(v.string()),
    imageUrl: v.optional(v.string()),
    priceRange: v.optional(v.object({
      minPrice: v.string(),
      maxPrice: v.string(),
      currencyCode: v.string(),
    })),
    variantCount: v.number(),
    stockCount: v.optional(v.number()),
    category: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const teamMember = await getCurrentTeamMember(ctx);
    if (!teamMember) {
      throw new Error("unauthenticated");
    }

    // Generate a unique shopifyProductId for manual creation
    const shopifyProductId = `manual_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const productId = await ctx.db.insert("products", {
      brandId: args.brandId,
      shopifyProductId,
      title: args.title,
      description: args.description,
      handle: args.handle,
      productType: args.productType,
      vendor: args.vendor,
      status: args.status,
      tags: args.tags,
      imageUrl: args.imageUrl,
      priceRange: args.priceRange,
      variantCount: args.variantCount,
      stockCount: args.stockCount,
      category: args.category,
      syncedAt: Date.now(),
    });

    return productId;
  },
});

// Update a product
export const updateProduct = mutation({
  args: {
    productId: v.id("products"),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    handle: v.optional(v.string()),
    productType: v.optional(v.string()),
    vendor: v.optional(v.string()),
    status: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    imageUrl: v.optional(v.string()),
    priceRange: v.optional(v.object({
      minPrice: v.string(),
      maxPrice: v.string(),
      currencyCode: v.string(),
    })),
    variantCount: v.optional(v.number()),
    stockCount: v.optional(v.number()),
    category: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const teamMember = await getCurrentTeamMember(ctx);
    if (!teamMember) {
      throw new Error("unauthenticated");
    }

    const updateData: any = {};
    if (args.title !== undefined) updateData.title = args.title;
    if (args.description !== undefined) updateData.description = args.description;
    if (args.handle !== undefined) updateData.handle = args.handle;
    if (args.productType !== undefined) updateData.productType = args.productType;
    if (args.vendor !== undefined) updateData.vendor = args.vendor;
    if (args.status !== undefined) updateData.status = args.status;
    if (args.tags !== undefined) updateData.tags = args.tags;
    if (args.imageUrl !== undefined) updateData.imageUrl = args.imageUrl;
    if (args.priceRange !== undefined) updateData.priceRange = args.priceRange;
    if (args.variantCount !== undefined) updateData.variantCount = args.variantCount;
    if (args.stockCount !== undefined) updateData.stockCount = args.stockCount;
    if (args.category !== undefined) updateData.category = args.category;
    updateData.syncedAt = Date.now();

    await ctx.db.patch(args.productId, updateData);
    return args.productId;
  },
});

// Delete a product
export const deleteProductMutation = mutation({
  args: { productId: v.id("products") },
  handler: async (ctx, args) => {
    const teamMember = await getCurrentTeamMember(ctx);
    if (!teamMember) {
      throw new Error("unauthenticated");
    }

    await ctx.db.delete(args.productId);
    return args.productId;
  },
});