import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { auth } from "./auth";
import { classifyError } from "./lib/errorKind";

const http = httpRouter();

auth.addHttpRoutes(http);

// --- Stripe Billing Webhook ---

http.route({
  path: "/stripe/webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = await request.text();
    const signature = request.headers.get("stripe-signature");
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!signature || !webhookSecret) {
      return new Response("Missing Stripe webhook configuration", { status: 400 });
    }

    const verified = await verifyStripeWebhookSignature(body, signature, webhookSecret);
    if (!verified) {
      return new Response("Invalid Stripe signature", { status: 401 });
    }

    let event: any;
    try {
      event = JSON.parse(body);
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    try {
      await ctx.runMutation(internal.billing.processStripeEventInternal, { event });
      return new Response(JSON.stringify({ received: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("[stripe-webhook] processing failed:", error);
      return new Response("Webhook processing failed", { status: 500 });
    }
  }),
});

async function verifyStripeWebhookSignature(body: string, signatureHeader: string, secret: string) {
  const parts = signatureHeader.split(",").reduce<Record<string, string[]>>((acc, part) => {
    const [key, value] = part.split("=");
    if (!key || !value) return acc;
    acc[key] = [...(acc[key] ?? []), value];
    return acc;
  }, {});
  const timestamp = parts.t?.[0];
  const signatures = parts.v1 ?? [];
  if (!timestamp || signatures.length === 0) return false;

  const timestampMs = Number(timestamp) * 1000;
  if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > 5 * 60 * 1000) {
    return false;
  }

  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(`${timestamp}.${body}`));
  const expected = Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return signatures.some((candidate) => constantTimeEqual(candidate, expected));
}

function constantTimeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

// --- Shopify OAuth Flow ---

http.route({
  path: "/shopify/auth",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const shop = url.searchParams.get("shop");
    const nonce = url.searchParams.get("nonce");
    const appUrl = process.env.SITE_URL || "http://localhost:5173";

    if (!shop || !nonce) {
      return new Response(null, {
        status: 302,
        headers: { Location: `${appUrl}/?shopify_error=missing_params` },
      });
    }

    // Trade the nonce for the caller's userId. The nonce can only have been
    // minted by an authenticated mutation, so whoever holds it proves they
    // were signed in when the flow started. Anyone without a valid nonce is
    // bounced here - the browser can no longer pick its own userId.
    const consumed = await ctx.runMutation(internal.oauthNonces.consumeNonce, {
      nonce,
      provider: "shopify",
    });
    if (!consumed) {
      return new Response(null, {
        status: 302,
        headers: { Location: `${appUrl}/?shopify_error=invalid_nonce` },
      });
    }
    const userId = consumed.userId;

    const clientId = process.env.SHOPIFY_CLIENT_ID;
    if (!clientId) {
      return new Response("Missing SHOPIFY_CLIENT_ID", { status: 500 });
    }

    // Construct the Shopify OAuth authorization URL
    const redirectUri = `${process.env.CONVEX_SITE_URL}/shopify/callback`;
    const scopes = "read_products,unauthenticated_read_product_listings";

    // userId is now trusted (came from the consumed nonce); passing as state
    const state = userId;

    const authUrl = `https://${shop}/admin/oauth/authorize?client_id=${clientId}&scope=${scopes}&redirect_uri=${redirectUri}&state=${state}`;

    return new Response(null, {
      status: 302,
      headers: {
        Location: authUrl,
      },
    });
  }),
});

http.route({
  path: "/shopify/callback",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const appUrl = process.env.SITE_URL || "http://localhost:5173";
    const shop = url.searchParams.get("shop");
    const code = url.searchParams.get("code");
    const userId = url.searchParams.get("state"); // Extracted from the state param

    // Handle OAuth denial - redirect back to app with error instead of showing 400
    const oauthError = url.searchParams.get("error");
    if (oauthError) {
      return new Response(null, {
        status: 302,
        headers: { Location: `${appUrl}/settings?section=integrations&shopify_error=${encodeURIComponent(oauthError)}` },
      });
    }

    if (!shop || !code || !userId) {
      return new Response(null, {
        status: 302,
        headers: { Location: `${appUrl}/settings?section=integrations&shopify_error=missing_params` },
      });
    }

    const clientId = process.env.SHOPIFY_CLIENT_ID;
    const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      return new Response("Server configuration error", { status: 500 });
    }

    // --- HMAC Verification ---
    // Shopify signs every callback with HMAC so we can verify this came from Shopify
    // and not a spoofed redirect attack.
    const hmacParam = url.searchParams.get("hmac");
    if (!hmacParam) {
      return new Response("Missing HMAC signature", { status: 401 });
    }
    // Rebuild the query string without the `hmac` param, sorted alphabetically
    const params = [...url.searchParams.entries()]
      .filter(([key]) => key !== "hmac")
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join("&");
    
    const encoder = new TextEncoder();
    const keyData = encoder.encode(clientSecret);
    const messageData = encoder.encode(params);
    const cryptoKey = await crypto.subtle.importKey(
      "raw", keyData, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
    );
    const signature = await crypto.subtle.sign("HMAC", cryptoKey, messageData);
    const computedHmac = Array.from(new Uint8Array(signature))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    
    if (computedHmac !== hmacParam) {
      return new Response("HMAC verification failed", { status: 401 });
    }
    // --- End HMAC Verification ---

    try {
      // 1. Exchange the authorization code for an access token
      const tokenResponse = await fetch(`https://${shop}/admin/oauth/access_token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          // Expiring offline tokens are mandatory for public apps registered
          // after April 1, 2026. Non-expiring tokens are rejected by the Admin API.
          expiring: "1",
        }),
      });

      if (!tokenResponse.ok) {
        throw new Error(`Token exchange failed: ${await tokenResponse.text()}`);
      }

      const tokenData = await tokenResponse.json();
      const accessToken: string | undefined = tokenData.access_token;
      const refreshToken: string | undefined = tokenData.refresh_token;
      const expiresIn: number | undefined = tokenData.expires_in;
      const accessTokenExpiresAt = expiresIn ? Date.now() + expiresIn * 1000 : undefined;

      if (!accessToken) {
        console.error("[Shopify] Token exchange returned no access_token:", tokenData);
        return new Response(null, {
          status: 302,
          headers: { Location: `${appUrl}/settings?section=integrations&shopify_error=token_exchange_failed` },
        });
      }

      // 2. Fetch store info from Shopify using the new token
      const shopResponse = await fetch(`https://${shop}/admin/api/2024-04/graphql.json`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": accessToken,
        },
        body: JSON.stringify({
          query: `{
            shop {
              name
              description
              myshopifyDomain
              billingAddress {
                countryCodeV2
              }
              primaryDomain {
                url
              }
              contactEmail
              currencyCode
              weightUnit
              ianaTimezone
            }
          }`
        }),
      });

      const shopData = await shopResponse.json();
      const shopInfo = shopData?.data?.shop;

      if (!shopInfo) {
        console.error("[Shopify] Failed to fetch shop info:", shopData?.errors || "No shop data");
        // Continue with fallback data - don't fail the entire OAuth
      }

      // 2.5 Fetch Storefront Access Token & Brand Assets
      let brandAssets: any = null;
      let sfToken: string | undefined;
      try {
        const sfTokenResponse = await fetch(`https://${shop}/admin/api/2024-04/graphql.json`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": accessToken,
          },
          body: JSON.stringify({
            query: `mutation {
              storefrontAccessTokenCreate(input: { title: "SIRz Onboarding" }) {
                storefrontAccessToken { accessToken }
              }
            }`
          }),
        });
        const sfTokenData = await sfTokenResponse.json();
        sfToken = sfTokenData?.data?.storefrontAccessTokenCreate?.storefrontAccessToken?.accessToken;

        if (sfToken) {
          const storefrontResponse = await fetch(`https://${shop}/api/2024-04/graphql.json`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Shopify-Storefront-Access-Token": sfToken,
            },
            body: JSON.stringify({
              query: `{
                shop {
                  brand {
                    logo { image { url } }
                    coverImage { image { url } }
                    colors {
                      primary { background }
                      secondary { background }
                    }
                    shortDescription
                  }
                }
              }`
            }),
          });
          const sfData = await storefrontResponse.json();
          brandAssets = sfData?.data?.shop?.brand;
        }
      } catch (e) {
        console.error("Failed to fetch Storefront API brand assets:", e);
      }
      
      const storeData = {
        name: (shopInfo?.name || shop).replace(/\.myshopify\.com$/, '').replace(/\.[a-z]+$/, ''),
        description: brandAssets?.shortDescription || shopInfo?.description,
        myshopifyDomain: shopInfo?.myshopifyDomain,
        url: shopInfo?.primaryDomain?.url || `https://${shop}`,
        email: shopInfo?.contactEmail,
        currency: shopInfo?.currencyCode,
        weightUnit: shopInfo?.weightUnit,
        timezone: shopInfo?.ianaTimezone,
        countryCode: shopInfo?.billingAddress?.countryCodeV2,
        logoUrl: brandAssets?.logo?.image?.url,
        coverImage: brandAssets?.coverImage?.image?.url,
        primaryColor: brandAssets?.colors?.primary?.[0]?.background,
        secondaryColor: brandAssets?.colors?.secondary?.[0]?.background,
        storefrontAccessToken: sfToken,
      };

      console.log(`[Shopify] Store connected: ${shop} (${shopInfo?.name || 'Unknown'})`);

      // 3. Save the integration to our database securely
      // Using Promise to capture the returned integration ID if needed, 
      // but runMutation here doesn't return the ID cleanly unless we modify it.
      // We'll trust it succeeds and fetch it if needed, or modify the mutation to return ID.
      // Actually, since we need the ID, let's just query it back immediately.
      await ctx.runMutation(internal.integrations.saveShopifyIntegration, {
        userId: userId as any,
        accessToken,
        refreshToken,
        accessTokenExpiresAt,
        domain: shop,
        storeData,
      });

      const integration = await ctx.runQuery(internal.integrations.getShopifyIntegrationInternal, {
        userId: userId as any,
      });

      // 4. Register Webhooks & Trigger Initial Sync
      if (integration) {
        const webhookTopics = ["products/create", "products/update", "products/delete"];
        const webhookUrl = `${process.env.CONVEX_SITE_URL}/shopify/webhooks`;

        for (const topic of webhookTopics) {
          try {
            await fetch(`https://${shop}/admin/api/2024-04/webhooks.json`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Shopify-Access-Token": accessToken,
              },
              body: JSON.stringify({
                webhook: {
                  topic,
                  address: webhookUrl,
                  format: "json",
                },
              }),
            });
          } catch (e) {
            console.error(`Failed to register webhook ${topic}:`, e);
          }
        }

        // Fetch the user's active brand so we can correctly associate synced products
        console.log(`[OAuth] Looking up active brand for userId: ${userId}`);
        const brand = await ctx.runQuery(internal.brands.getBrandByUserId, {
          userId: userId as any,
        });

        if (brand) {
          console.log(`[OAuth] Found active brand: ${brand._id} (${brand.name}). Scheduling background sync...`);
          // Schedule as a background job - runs immediately but doesn't block the redirect
          await ctx.scheduler.runAfter(0, api.products.syncProducts, {
            integrationId: integration._id,
            brandId: brand._id,
            accessToken,
            domain: shop,
          });
        } else {
          console.warn(`[OAuth] No active brand found for userId ${userId} - skipping initial product sync`);
        }
      }

      // 5. Redirect the user back to the frontend app
      return new Response(null, {
        status: 302,
        headers: {
          Location: `${appUrl}/settings?section=integrations&shopify_connected=true`,
        },
      });

    } catch (error) {
      console.error("Shopify OAuth Error:", error);
      const appUrl = process.env.SITE_URL || "http://localhost:5173";
      return new Response(null, {
        status: 302,
        headers: { Location: `${appUrl}/settings?section=integrations&shopify_error=oauth_failed` },
      });
    }
  }),
});

// --- Shopify Webhooks ---

http.route({
  path: "/shopify/webhooks",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const rawBody = await request.text();
    const hmacHeader = request.headers.get("X-Shopify-Hmac-Sha256");
    const topic = request.headers.get("X-Shopify-Topic");
    const shop = request.headers.get("X-Shopify-Shop-Domain");

    if (!hmacHeader || !topic || !shop) {
      return new Response("Missing required webhook headers", { status: 400 });
    }

    const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
    if (!clientSecret) {
      return new Response("Server configuration error", { status: 500 });
    }

    // --- HMAC Verification ---
    const encoder = new TextEncoder();
    const keyData = encoder.encode(clientSecret);
    const messageData = encoder.encode(rawBody);
    
    const cryptoKey = await crypto.subtle.importKey(
      "raw", keyData, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
    );
    
    // Shopify webhooks use SHA256 Base64 HMAC (different from OAuth callback hex HMAC)
    const signatureBytes = await crypto.subtle.sign("HMAC", cryptoKey, messageData);
    const generatedHmacBase64 = btoa(String.fromCharCode(...new Uint8Array(signatureBytes)));

    if (generatedHmacBase64 !== hmacHeader) {
      console.error(`Webhook HMAC verification failed for shop: ${shop}`);
      return new Response("Unauthorized", { status: 401 });
    }
    // --- End HMAC Verification ---

    try {
      const payload = JSON.parse(rawBody);

      // ─── GDPR / mandatory compliance webhooks ─────────────────────────────
      // Shopify requires every public app to respond 200 to these three topics.
      // SIRz only stores Shopify product catalog + integration metadata - no
      // customer or order data - so the customer-data webhooks just acknowledge.
      // shops/redact triggers a full purge of the shop's Shopify-sourced data.
      if (topic === "customers/data_request") {
        console.log(`[compliance] customers/data_request for shop=${shop}, customer=${payload?.customer?.id} - no customer data stored, acknowledging.`);
        return new Response("OK", { status: 200 });
      }

      if (topic === "customers/redact") {
        console.log(`[compliance] customers/redact for shop=${shop}, customer=${payload?.customer?.id} - no customer data stored, acknowledging.`);
        return new Response("OK", { status: 200 });
      }

      // Both "shop/redact" (singular, used in shopify.app.toml compliance_topics)
      // and "shops/redact" (plural, seen on some legacy webhook headers) refer
      // to the same event. Accept both to stay forward/backward compatible.
      if (topic === "shop/redact" || topic === "shops/redact") {
        const shopDomain = payload?.shop_domain || shop;
        console.log(`[compliance] ${topic} for shop=${shopDomain} - purging Shopify-sourced data.`);
        const result = await ctx.runMutation(internal.integrations.purgeShopifyDataForShop, {
          domain: shopDomain,
        });
        console.log(`[compliance] ${topic} result:`, result);
        return new Response("OK", { status: 200 });
      }

      // ─── Standard webhooks (product sync) ──────────────────────────────────
      // Need to find the associated integration and brand
      const integration = await ctx.runQuery(internal.integrations.getIntegrationByDomain, { domain: shop });

      if (!integration) {
        console.warn(`Received webhook for unknown shop: ${shop}`);
        return new Response("Shop not found", { status: 200 }); // Return 200 so Shopify stops retrying
      }

      const brand = await ctx.runQuery(internal.brands.getBrandByUserId, { userId: integration.userId });
      if (!brand) {
        console.warn(`No active brand found for user ${integration.userId}`);
        return new Response("Brand not found", { status: 200 });
      }

      if (topic === "products/create" || topic === "products/update") {
        await ctx.runMutation(internal.products.upsertProduct, {
          brandId: brand._id,
          productData: payload,
        });
      } else if (topic === "products/delete") {
        await ctx.runMutation(internal.products.deleteProduct, {
          shopifyProductId: `gid://shopify/Product/${payload.id}`,
        });
      }

      // Keep the integration's product count in sync after every webhook event
      await ctx.runMutation(internal.products.refreshProductCount, {
        integrationId: integration._id,
        brandId: brand._id,
      });

      return new Response("OK", { status: 200 });

    } catch (e) {
      console.error("Error processing Shopify webhook:", e);
      return new Response("Internal Server Error", { status: 500 });
    }
  }),
});

// --- File Uploads (Cloudflare R2) ---

http.route({
  path: "/upload/presign",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    // --- Auth guard ---
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return new Response("Unauthorized", { status: 403 });
    }

    const { brandId, folder, assetName, contentType } = await request.json() as {
      brandId: string;
      folder: "identity" | "videos" | "campaigns" | "posts" | "blog" | "email" | "references" | "products";
      assetName: string;
      contentType: string;
    };

    if (!brandId || !folder || !assetName || !contentType) {
      return new Response("Missing required fields: brandId, folder, assetName, contentType", { status: 400 });
    }

    const accountId = process.env.CF_ACCOUNT_ID;
    const bucketName = process.env.CF_R2_BUCKET;
    const accessKeyId = process.env.CF_R2_ACCESS_KEY_ID;
    const secretAccessKey = process.env.CF_R2_SECRET_ACCESS_KEY;

    if (!accountId || !bucketName || !accessKeyId || !secretAccessKey) {
      console.error("Missing R2 credentials");
      return new Response("Storage configuration error", { status: 500 });
    }

    // Dynamic import to avoid blowing up the edge runtime if we don't hit this route
    const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");
    const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");

    const s3 = new S3Client({
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
      // Disable automatic CRC32 checksum injection - AWS SDK v3 adds
      // x-amz-checksum-crc32 to presigned URLs by default which R2's
      // CORS policy rejects during the browser preflight.
      requestChecksumCalculation: "WHEN_REQUIRED",
    });

    // Structured key: brands/{brandId}/{folder}/{assetName}
    // Fixed key per asset type - R2 natively overwrites on re-upload, no cleanup needed
    const key = `brands/${brandId}/${folder}/${assetName}`;

    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      ContentType: contentType,
    });

    const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });
    const publicUrl = `https://pub-1f5cd68cca10472e9224eff87e49d3fb.r2.dev/${key}`;

    return new Response(JSON.stringify({ uploadUrl, publicUrl }), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }),
});

// OPTIONS handler for CORS preflight on the presign route
http.route({
  path: "/upload/presign",
  method: "OPTIONS",
  handler: httpAction(async (_ctx, _request) => {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }),
});

// --- fal.ai Webhook (Specialized Agent Completions) ---
// fal.ai POSTs here when an async generation job finishes.
// We match the request_id to a task row via falRequestId index and complete it.

http.route({
  path: "/api/fal-webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const requestUrl = new URL(request.url);
    const taskIdFromQuery = requestUrl.searchParams.get("taskId") as Id<"agentTasks"> | null;

    let body: any;
    try {
      body = await request.json();
    } catch {
      return new Response("Invalid JSON body", { status: 400 });
    }

    // fal.ai webhook payload structure:
    // { request_id, status: "OK" | "ERROR", payload: { images: [...] } | error }
    const requestId = body?.request_id;
    const status = body?.status;

    if (!requestId) {
      console.error("[fal-webhook] Missing request_id in payload:", JSON.stringify(body));
      return new Response("Missing request_id", { status: 400 });
    }

    console.log(`[fal-webhook] Received callback for requestId: ${requestId}, status: ${status}`);

    // Find the task row by fal.ai request ID
    const task = await ctx.runQuery(internal.agentTasks.getTaskByFalRequestId, {
      falRequestId: requestId,
    });

    if (!task) {
      console.warn(`[fal-webhook] No task found for requestId: ${requestId}`);
      // Return 200 so fal.ai doesn't keep retrying
      return new Response("Task not found (already processed or unknown)", { status: 200 });
    }

    if (status === "OK" || status === "COMPLETED") {
      // Extract the output based on agent type
      const payload = body?.payload;
      let output: any;

      if (task.agentType === "character_designer") {
        const imageUrl = payload?.images?.[0]?.url;
        if (!imageUrl) {
          await ctx.runMutation(internal.agentTasks.failTask, {
            taskId: task._id,
            error: "fal.ai returned OK but no image URL was found in the payload.",
          });
          return new Response("OK", { status: 200 });
        }
        output = {
          imageUrl,
          prompt: task.input?.builtPrompt || "",
          model: "fal-ai/gpt-image-1.5",
          generatedAt: Date.now(),
        };
      } else if (task.agentType === "image_generator") {
        const imageUrl = payload?.images?.[0]?.url;
        if (!imageUrl) {
          await ctx.runMutation(internal.agentTasks.failTask, {
            taskId: task._id,
            error: "fal.ai returned OK but no image URL was found in the image_generator payload.",
          });
          return new Response("OK", { status: 200 });
        }
        output = {
          imageUrl,
          prompt: task.input?.builtPrompt || "",
          model: task.input?.resolvedModel || "fal-ai/gpt-image-1.5",
          generatedAt: Date.now(),
        };
      } else if (task.agentType === "video_generator") {
        const videoUrl = payload?.video?.url;
        if (!videoUrl) {
          await ctx.runMutation(internal.agentTasks.failTask, {
            taskId: task._id,
            error: "fal.ai returned OK but no video URL was found in the video_generator payload.",
          });
          return new Response("OK", { status: 200 });
        }
        const thumbnailUrl =
          payload?.video?.thumbnail_url ||
          payload?.video?.thumbnailUrl ||
          payload?.thumbnail?.url ||
          payload?.thumbnailUrl ||
          task.input?.resolvedStartImageUrl ||
          undefined;
        output = {
          videoUrl,
          thumbnailUrl,
          prompt: task.input?.builtPrompt || "",
          model: task.input?.resolvedModel || "fal-ai/kling-video/v3/standard/text-to-video",
          generatedAt: Date.now(),
        };
      } else {
        // Generic output for future agent types
        output = { payload, generatedAt: Date.now() };
      }

      await ctx.runMutation(internal.agentTasks.completeTask, {
        taskId: task._id,
        output,
      });

      // Persist a custom ambassador row for character_designer outputs server-side.
      // Doing this here (rather than in the client effect) means it works even
      // when the user navigates away from Settings while the task is running.
      if (task.agentType === "character_designer" && task.brandId && output?.imageUrl) {
        try {
          await ctx.runMutation(internal.ambassadors.upsertCustomAmbassadorForTask, {
            brandId: task.brandId,
            generationTaskId: task._id,
            imageUrl: output.imageUrl,
          });
        } catch (ambassadorError) {
          console.error(`[fal-webhook] Failed to upsert ambassador for task ${task._id}:`, ambassadorError);
        }
      }

      console.log(`[fal-webhook] Task ${task._id} completed successfully.`);

      // Push notification if threadId exists
      if (task.threadId) {
        try {
          await ctx.runAction(api.agent.pushTaskNotification, {
            userId: task.userId,
            brandId: task.brandId,
            taskId: task._id,
            taskLabel: task.label,
            output,
          });
        } catch (notifyError) {
          console.error(`[fal-webhook] Failed to send notification:`, notifyError);
        }
      }
    } else {
      // ERROR or any other non-OK status
      let errorMessage =
        body?.payload?.detail ||
        body?.error ||
        `fal.ai reported status: ${status}`;

      if (typeof errorMessage !== "string") {
        try {
          errorMessage = JSON.stringify(errorMessage);
        } catch (e) {
          errorMessage = "Unknown error object";
        }
      }

      const httpStatus = typeof body?.status_code === "number" ? body.status_code : undefined;
      const kind = classifyError({ status: httpStatus, message: errorMessage });
      await ctx.runMutation(internal.agentTasks.failTask, {
        taskId: task._id,
        error: errorMessage,
        errorKind: kind,
      });

      console.error(`[fal-webhook] Task ${task._id} failed (${kind}): ${errorMessage}`);

      // Push notification to Copilot thread if threadId exists
      if (task.threadId) {
        try {
          await ctx.runAction(api.agent.pushTaskNotification, {
            userId: task.userId,
            brandId: task.brandId,
            taskId: task._id,
            taskLabel: task.label,
            output: null,
            error: errorMessage,
          });
        } catch (notifyError) {
          console.error(`[fal-webhook] Failed to send failure notification:`, notifyError);
        }
      }
    }

    return new Response("OK", { status: 200 });
  }),
});

// OPTIONS for fal-webhook CORS
http.route({
  path: "/api/fal-webhook",
  method: "OPTIONS",
  handler: httpAction(async (_ctx, _request) => {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }),
});

export default http;

// --- TikTok OAuth Flow ---

http.route({
  path: "/tiktok/auth",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const nonce = url.searchParams.get("nonce");
    const appUrl = process.env.SITE_URL || "http://localhost:5173";

    if (!nonce) {
      return new Response(null, {
        status: 302,
        headers: { Location: `${appUrl}/?tiktok_error=missing_params` },
      });
    }

    // Consume the nonce to recover the brandId. The nonce mutation already
    // verified the caller owned this brand, so we don't have to trust the URL.
    const consumed = await ctx.runMutation(internal.oauthNonces.consumeNonce, {
      nonce,
      provider: "tiktok",
    });
    if (!consumed || !consumed.brandId) {
      return new Response(null, {
        status: 302,
        headers: { Location: `${appUrl}/?tiktok_error=invalid_nonce` },
      });
    }
    const brandId = consumed.brandId;

    const clientKey = process.env.TIKTOK_CLIENT_KEY;
    if (!clientKey) {
      return new Response("Missing TIKTOK_CLIENT_KEY", { status: 500 });
    }

    const redirectUri = `${process.env.CONVEX_SITE_URL}/tiktok/callback`;
    // Scopes:
    //   user.info.basic - Login Kit; identifies the connected creator
    //   video.publish   - Direct Post (publish AI-generated ads)
    //   video.list      - analytics (read like/comment/share/view counts on
    //                     posts SIRz published for this merchant)
    const scope = "user.info.basic,video.publish,video.list";
    const returnTo = url.searchParams.get("returnTo") || "";
    // Encode returnTo into state so the callback can redirect back to the right page.
    // Format: brandId:::returnTo (both URL-safe segments).
    const state = returnTo ? `${brandId}:::${encodeURIComponent(returnTo)}` : brandId;

    const authUrl = `https://www.tiktok.com/v2/auth/authorize/?client_key=${clientKey}&response_type=code&scope=${encodeURIComponent(scope)}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}`;

    return new Response(null, {
      status: 302,
      headers: {
        Location: authUrl,
      },
    });
  }),
});

http.route({
  path: "/tiktok/callback",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const appUrl = process.env.SITE_URL || "http://localhost:5173";
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const rawState = url.searchParams.get("state") || "";
    const error = url.searchParams.get("error");

    // Parse state: may be plain brandId or "brandId:::encodedReturnTo"
    const stateParts = rawState.split(":::");
    const brandId = stateParts[0] || null;
    const returnTo = stateParts[1] ? decodeURIComponent(stateParts[1]) : null;
    // Only allow relative paths to prevent open redirect attacks.
    const safeReturnTo = returnTo && returnTo.startsWith("/") ? returnTo : null;
    const successUrl = safeReturnTo
      ? `${appUrl}${safeReturnTo}${safeReturnTo.includes("?") ? "&" : "?"}tiktok_connected=true`
      : `${appUrl}/?tiktok_connected=true`;
    const errorBase = safeReturnTo
      ? `${appUrl}${safeReturnTo}${safeReturnTo.includes("?") ? "&" : "?"}`
      : `${appUrl}/?`;

    if (error) {
      console.error("[TikTok OAuth] Error from TikTok:", error, url.searchParams.get("error_description"));
      return new Response(null, {
        status: 302,
        headers: {
          Location: `${errorBase}tiktok_error=${encodeURIComponent(error)}`,
        },
      });
    }

    if (!code || !brandId) {
      return new Response(null, {
        status: 302,
        headers: { Location: `${errorBase}tiktok_error=missing_params` },
      });
    }

    const clientKey = process.env.TIKTOK_CLIENT_KEY;
    const clientSecret = process.env.TIKTOK_CLIENT_SECRET;

    if (!clientKey || !clientSecret) {
      return new Response(null, {
        status: 302,
        headers: { Location: `${appUrl}/?tiktok_error=server_config` },
      });
    }

    try {
      // Exchange authorization code for access token
      const tokenResponse = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          client_key: clientKey,
          client_secret: clientSecret,
          code: code,
          grant_type: "authorization_code",
          redirect_uri: `${process.env.CONVEX_SITE_URL}/tiktok/callback`,
        }),
      });

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        console.error("[TikTok OAuth] Token exchange failed:", errorText);
        throw new Error(`Token exchange failed: ${errorText}`);
      }

      const tokenData = await tokenResponse.json();

      const accessToken = tokenData.access_token;
      const refreshToken = tokenData.refresh_token;
      const expiresIn = tokenData.expires_in; // seconds
      const openId = tokenData.open_id;
      // Granted scopes from TikTok's response. May differ from what we
      // requested if the merchant declined a scope at the consent screen.
      // Stored on the connection so the frontend can detect when a
      // re-authorization is required after we add new scopes.
      const grantedScopes: string | undefined = tokenData.scope;

      if (!accessToken || !openId) {
        throw new Error("Missing access_token or open_id in response");
      }

      // Fetch user info to get account name
      const userResponse = await fetch("https://open.tiktokapis.com/v2/user/info/?fields=display_name,avatar_url", {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      let accountName = "TikTok Account";
      let accountAvatarUrl: string | undefined;
      if (userResponse.ok) {
        const userData = await userResponse.json();
        accountName = userData.data?.user?.display_name || "TikTok Account";
        accountAvatarUrl = userData.data?.user?.avatar_url || undefined;
      }

      // Save the connection (brandId is passed as state from the auth initiation)
      const connectionId = await ctx.runMutation(internal.platformConnections.saveConnection, {
        brandId: brandId as any,
        platform: "tiktok",
        accessToken,
        refreshToken,
        accountId: openId,
        accountName,
        accountAvatarUrl,
        expiresAt: Date.now() + (expiresIn * 1000),
        grantedScopes,
      });

      console.log(`[TikTok OAuth] Connected TikTok account for brand ${brandId}: ${accountName}`);

      // TikTok avatar URLs are short-lived signed CDN links (they 403 after
      // the signature expires). Copy to R2 in the background so we serve a
      // permanent URL. Callback returns fast; the avatar swaps in moments later.
      if (accountAvatarUrl && connectionId) {
        await ctx.scheduler.runAfter(0, internal.platformConnections.syncTiktokAvatarToR2, {
          connectionId,
          sourceUrl: accountAvatarUrl,
          brandId: brandId as any,
          accountId: openId,
        });
      }

      return new Response(null, {
        status: 302,
        headers: { Location: successUrl },
      });

    } catch (error) {
      console.error("[TikTok OAuth Error]:", error);
      return new Response(null, {
        status: 302,
        headers: { Location: `${errorBase}tiktok_error=oauth_failed` },
      });
    }
  }),
});
