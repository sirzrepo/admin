import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { auth } from "./auth";

const http = httpRouter();

auth.addHttpRoutes(http);

// --- Shopify OAuth Flow ---

http.route({
  path: "/shopify/auth",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const shop = url.searchParams.get("shop");
    const userId = url.searchParams.get("userId"); // Passed from the frontend button

    if (!shop || !userId) {
      return new Response("Missing shop or userId parameter", { status: 400 });
    }

    const clientId = process.env.SHOPIFY_CLIENT_ID;
    if (!clientId) {
      return new Response("Missing SHOPIFY_CLIENT_ID", { status: 500 });
    }

    // Construct the Shopify OAuth authorization URL
    const redirectUri = `${process.env.CONVEX_SITE_URL}/shopify/callback`;
    const scopes = "read_products,read_orders,read_content,read_customers,unauthenticated_read_content,unauthenticated_read_product_listings";
    
    // We pass the userId in the `state` parameter so we can retrieve it in the callback
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
    const shop = url.searchParams.get("shop");
    const code = url.searchParams.get("code");
    const userId = url.searchParams.get("state"); // Extracted from the state param

    if (!shop || !code || !userId) {
      return new Response("Missing required OAuth parameters", { status: 400 });
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
        }),
      });

      if (!tokenResponse.ok) {
        throw new Error(`Token exchange failed: ${await tokenResponse.text()}`);
      }

      const tokenData = await tokenResponse.json();
      const accessToken = tokenData.access_token;

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
      console.log("[1/4 Admin API Response]:", JSON.stringify(shopData));
      const shopInfo = shopData?.data?.shop;

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
        console.log("[2/4 Storefront Token Creation]:", JSON.stringify(sfTokenData));
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
          console.log("[3/4 Storefront Brand Query]:", JSON.stringify(sfData));
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

      console.log("[4/4 Final storeData]:", JSON.stringify(storeData));

      // 3. Save the integration to our database securely
      // Using Promise to capture the returned integration ID if needed, 
      // but runMutation here doesn't return the ID cleanly unless we modify it.
      // We'll trust it succeeds and fetch it if needed, or modify the mutation to return ID.
      // Actually, since we need the ID, let's just query it back immediately.
      await ctx.runMutation(internal.integrations.saveShopifyIntegration, {
        userId: userId as any,
        accessToken,
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
          // Schedule as a background job — runs immediately but doesn't block the redirect
          await ctx.scheduler.runAfter(0, api.products.syncProducts, {
            integrationId: integration._id,
            brandId: brand._id,
            accessToken,
            domain: shop,
          });
        } else {
          console.warn(`[OAuth] No active brand found for userId ${userId} — skipping initial product sync`);
        }
      }

      // 5. Redirect the user back to the frontend app, closing the OAuth window flow
      // Normally you might use postMessage to a parent window if this opened in a popup, 
      // or redirect back to the app URL with a success parameter.
      const appUrl = process.env.SITE_URL || "http://localhost:5173";
      
      return new Response(null, {
        status: 302,
        headers: {
          Location: `${appUrl}/?shopify_connected=true`,
        },
      });

    } catch (error) {
      console.error("Shopify OAuth Error:", error);
      return new Response("OAuth flow failed", { status: 500 });
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
      folder: "identity" | "videos" | "campaigns" | "posts" | "blog" | "email";
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
      // Disable automatic CRC32 checksum injection — AWS SDK v3 adds
      // x-amz-checksum-crc32 to presigned URLs by default which R2's
      // CORS policy rejects during the browser preflight.
      requestChecksumCalculation: "WHEN_REQUIRED",
    });

    // Structured key: brands/{brandId}/{folder}/{assetName}
    // Fixed key per asset type — R2 natively overwrites on re-upload, no cleanup needed
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
          model: "fal-ai/flux-pro/v1.1",
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

      console.log(`[fal-webhook] Task ${task._id} completed successfully.`);
    } else {
      // ERROR or any other non-OK status
      const errorMessage =
        body?.payload?.detail ||
        body?.error ||
        `fal.ai reported status: ${status}`;

      await ctx.runMutation(internal.agentTasks.failTask, {
        taskId: task._id,
        error: errorMessage,
      });

      console.error(`[fal-webhook] Task ${task._id} failed: ${errorMessage}`);
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
