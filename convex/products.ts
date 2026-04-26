import { action, internalMutation, mutation, query } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { Id } from "./_generated/dataModel";

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
      .paginate(args.paginationOpts);
  }
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
    // Shopify can return null for empty descriptions — coerce to undefined so Convex optional fields are satisfied
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
      // GraphQL bulk sync path — priceRangeV2 has exact min/max across all variants
      priceRange = {
        minPrice: productData.priceRangeV2.minVariantPrice.amount,
        maxPrice: productData.priceRangeV2.maxVariantPrice.amount,
        currencyCode: productData.priceRangeV2.minVariantPrice.currencyCode,
      };
    } else if (productData.variants && productData.variants.length > 0) {
      // REST webhook path — compute actual min/max across all variants
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

    // Build payload without explicit `undefined` values — Convex strict types require optional
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
    accessToken: v.string(),
    domain: v.string()
  },
  handler: async (ctx, args) => {
    const { integrationId, brandId, accessToken, domain } = args;

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

// Get a single product by ID
export const getProduct = query({
  args: { productId: v.id("products") },
  handler: async (ctx, args) => {
    const product = await ctx.db.get(args.productId);
    return product;
  },
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
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    // Verify user owns the brand
    const brand = await ctx.db.get(args.brandId);
    if (!brand || brand.userId !== userId) {
      throw new Error("Not authorized to create products for this brand");
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
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const product = await ctx.db.get(args.productId);
    if (!product) throw new Error("Product not found");

    // Verify user owns the brand
    const brand = await ctx.db.get(product.brandId);
    if (!brand || brand.userId !== userId) {
      throw new Error("Not authorized to update this product");
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
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const product = await ctx.db.get(args.productId);
    if (!product) throw new Error("Product not found");

    // Verify user owns the brand
    const brand = await ctx.db.get(product.brandId);
    if (!brand || brand.userId !== userId) {
      throw new Error("Not authorized to delete this product");
    }

    await ctx.db.delete(args.productId);
    return args.productId;
  },
});
