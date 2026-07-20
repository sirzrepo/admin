import { v } from "convex/values";
import { action, query, mutation } from "./_generated/server";
import { api, components, internal } from "./_generated/api";
import { Agent, createTool, listMessages, syncStreams, vStreamArgs } from "@convex-dev/agent";
import { paginationOptsValidator } from "convex/server";
import { z } from "zod";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { AGENT_REGISTRY } from "./specializedAgents/types";
import type { CharacterDesignerInput, AssetReference } from "./specializedAgents/types";

// ─── Notifications API ─────────────────────────────────────────────────────────
// Create a notification when a task completes
export const createNotification = mutation({
  args: {
    userId: v.string(),
    brandId: v.id("brands"),
    type: v.string(),
    title: v.string(),
    message: v.string(),
    taskId: v.optional(v.id("agentTasks")),
    link: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const notificationId = await ctx.db.insert("notifications", {
      userId: args.userId,
      brandId: args.brandId,
      type: args.type,
      title: args.title,
      message: args.message,
      taskId: args.taskId,
      link: args.link,
      read: false,
      createdAt: Date.now(),
    });
    return notificationId;
  },
});

// Get unread notifications for a user
export const getUnreadNotifications = query({
  args: {
    userId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit || 10;
    const notifications = await ctx.db
      .query("notifications")
      .withIndex("by_userId_read", (q) => 
        q.eq("userId", args.userId).eq("read", false)
      )
      .order("desc")
      .take(limit);
    return notifications;
  },
});

// Get ALL notifications for a user (both read and unread)
export const getAllNotifications = query({
  args: {
    userId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit || 20;
    const notifications = await ctx.db
      .query("notifications")
      .withIndex("by_userId", (q) => 
        q.eq("userId", args.userId)
      )
      .order("desc")
      .take(limit);
    return notifications;
  },
});

// Mark notification as read
export const markNotificationRead = mutation({
  args: {
    notificationId: v.id("notifications"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.notificationId, { read: true });
  },
});

// Get notification count
export const getUnreadCount = query({
  args: {
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    const notifications = await ctx.db
      .query("notifications")
      .withIndex("by_userId_read", (q) => 
        q.eq("userId", args.userId).eq("read", false)
      )
      .collect();
    return notifications.length;
  },
});

// ─── LLM configuration ──────────────────────────────────────────────────────
const MODEL = "openai/gpt-4o-mini";

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

// ─── Tool: listBrandProducts ─────────────────────────────────────────────────
// Lists products with their IDs and imageUrls for asset reference in image/video generation.
// Use search parameter to find specific products.
const listBrandProducts = createTool({
  description:
    "Search for products by name and get their IDs and imageUrls. " +
    "Use this when user mentions any product to find the exact product and its imageUrl. " +
    "Returns products in a format ready for assetReferences.",
  inputSchema: z.object({
    brandId: z.string().describe("The Convex document ID of the brand"),
    search: z.optional(z.string()).describe("Search term to find specific product (e.g., 'snowboard')"),
  }),
  execute: async (ctx, args: any): Promise<any> => {
    const { brandId, search } = args as { brandId: string; search?: string };
    const products = await ctx.runQuery(api.products.listProductsForAgent, {
      brandId: brandId as any,
    });
    if (!products || products.length === 0) {
      return JSON.stringify({ products: [], message: "No products found." });
    }

    let filteredProducts = products;
    // If search term provided, filter by it
    if (search) {
      const searchLower = search.toLowerCase();
      filteredProducts = products.filter((p: any) => 
        p.title?.toLowerCase().includes(searchLower)
      );
    }

    // Return products with IDs, imageUrls, and pricing
    const productList = filteredProducts.slice(0, 10).map((p: any) => {
      const minPrice = p.priceRange?.minPrice ? parseFloat(p.priceRange.minPrice) : null;
      const maxPrice = p.priceRange?.maxPrice ? parseFloat(p.priceRange.maxPrice) : null;
      const currency = p.priceRange?.currencyCode || '';
      return {
        id: p._id,
        shopifyId: p.shopifyProductId || null,
        title: p.title,
        handle: p.handle,
        imageUrl: p.imageUrl || null,
        productType: p.productType,
        status: p.status,
        minPrice,
        maxPrice,
        currency,
        priceLabel: minPrice != null
          ? (maxPrice && maxPrice !== minPrice ? `${currency} ${minPrice} - ${maxPrice}` : `${currency} ${minPrice}`)
          : null,
        stockCount: p.stockCount ?? null,
        vendor: p.vendor || null,
      };
    });

    // Separate products with and without images
    const withImages = productList.filter((p: any) => p.imageUrl);
    const withoutImages = productList.filter((p: any) => !p.imageUrl);

    const message = search 
      ? `Found ${productList.length} product(s) matching "${search}"`
      : `Found ${products.length} products. Showing first 10.`;

    return JSON.stringify({
      searchPerformed: search || null,
      products: productList,
      productsWithImages: withImages,
      productsWithoutImages: withoutImages,
      message,
    });
  },
});

// ─── Tool: listBrandAssets ─────────────────────────────────────────────────────
// Lists existing brand assets (characters) that can be referenced in image/video generation.
// Returns the most recent character ready for use in assetReferences.
const listBrandAssets = createTool({
  description:
    "Gets the most recent brand character for referencing in image or video generation. " +
    "Call this automatically when the user wants to include their brand character in generated content. " +
    "Returns the character in a format ready to use in assetReferences.",
  inputSchema: z.object({
    brandId: z.string().describe("The Convex document ID of the brand"),
  }),
  execute: async (ctx, args: any): Promise<any> => {
    const { brandId } = args as { brandId: string };
    
    // Get completed character designer tasks (these are the brand characters)
    const characterTasks = await ctx.runQuery(api.agentTasks.listRecentTasks, {
      brandId: brandId as any,
      agentType: "character_designer",
      limit: 1, // Just get the most recent one
    });
    
    const latestCharacter = characterTasks.find((t: any) => t.status === "completed" && t.output?.imageUrl);
    
    if (!latestCharacter) {
      return JSON.stringify({ hasCharacter: false, message: "No brand character found yet." });
    }
    
    // Return in assetReference format ready to use
    const assetRef: AssetReference = {
      type: "character",
      id: "brand-character",
      name: latestCharacter.label,
      imageUrl: latestCharacter.output.imageUrl,
    };
    
    return JSON.stringify({
      hasCharacter: true,
      character: assetRef,
      // Also provide a ready-to-use assetReferences array
      assetReferences: [assetRef],
    });
  },
});

// ─── Tool: listAmbassadors ─────────────────────────────────────────────────────
// Returns all preset + brand custom ambassadors so the agent can pick one when setting up a campaign with UGC Ads.
const listAmbassadors = createTool({
  description: "List all ambassadors (preset + brand's custom) the agent can pick from when setting up a campaign that includes AI UGC Ads. Use this to auto-select a fitting ambassador based on brand niche/tone.",
  inputSchema: z.object({
    brandId: z.string().describe("The Convex document ID of the brand"),
  }),
  execute: async (ctx, args: any): Promise<any> => {
    const presets: any[] = await ctx.runQuery(api.ambassadors.listPresetAmbassadors, {});
    const customs: any[] = await ctx.runQuery(api.ambassadors.listBrandAmbassadors, { brandId: args.brandId as any });

    // Brand's preferredAmbassadorId (if set) is the default choice
    const brand = await ctx.runQuery(api.brands.getBrandContext, { brandId: args.brandId as any });
    const preferredId = (brand as any)?.preferredAmbassadorId || null;

    const all = [...customs, ...presets].map(a => ({
      id: a._id,
      name: a.name,
      niche: a.niche,
      category: a.category,
      personality: a.personality,
      type: a.type, // "preset" | "custom"
      isPreferred: a._id === preferredId,
    }));

    return {
      ambassadors: all.slice(0, 12),
      preferredId,
      message: all.length === 0 ? "No ambassadors available - user should create or pick one first" : `Found ${all.length} ambassadors (${customs.length} custom, ${presets.length} preset)`,
    };
  },
});

// ─── Tool: dispatchToSpecializedAgent ─────────────────────────────────────────
// Replaces the old stub `routeToSkillAgent`.
// Gathers all required inputs, validates them, then submits a task via agentTasks.submitTask.
// Note: ugc_video is handled via video_generator with videoStyle: "UGC Ad" - no separate agent needed.
const dispatchToSpecializedAgent = createTool({
  description:
    "Dispatches a creative generation task to the appropriate specialized agent. " +
    "Call this ONLY when you have gathered ALL required information from the user. " +
    "Never call this if the agent type is not available (check the registry first). " +
    "Never call this if you are missing required fields like stylePreference (character) or prompt (image/video).",
  inputSchema: z.object({
    brandId: z.string().describe("The Convex document ID of the brand"),
    threadId: z.string().optional().describe("The thread ID for sending notifications when task completes"),
    agentType: z
      .union([
        z.literal("character_designer"),
        z.literal("image_generator"),
        z.literal("video_generator"),
      ])
      .describe("The type of specialized agent to use"),
    label: z.string().describe("Human-readable label for this task, e.g. 'Character Design for Lumínara'"),
    input: z.record(z.string(), z.any()).describe("All input fields required by the agent as a JSON object"),
    // Brand context - the agent auto-populates from DB, passes here as fallback-resolved values
    brandName: z.string().describe("Brand name (resolved from DB or asked from user)"),
    brandTone: z.string().optional().describe("Brand tone (resolved from DB or use default)"),
    primaryColor: z.string().optional().describe("Brand primary color (resolved from DB or use default)"),
  }),
  execute: async (ctx, args: any): Promise<any> => {
    const {
      brandId, threadId, agentType, label, input,
      brandName, brandTone, primaryColor,
    } = args as {
      brandId: string;
      threadId?: string;
      agentType: string;
      label: string;
      input: Record<string, any>;
      brandName: string;
      brandTone?: string;
      primaryColor?: string;
    };

    // Validate agent availability
    const registryEntry = AGENT_REGISTRY[agentType as keyof typeof AGENT_REGISTRY];
    if (!registryEntry?.available) {
      return {
        status: "unavailable",
        message: `${registryEntry?.label || agentType} is not yet available. It's coming soon.`,
      };
    }

    // Merge brand context fallbacks into the input for all agents
    let resolvedInput = { ...input };
    if (agentType === "character_designer") {
      resolvedInput = {
        brandName: brandName,
        brandTone: brandTone || "professional and approachable",
        primaryColor: primaryColor || "#1a1a2e",
        ...input,
      } as CharacterDesignerInput;
    } else if (agentType === "image_generator") {
      resolvedInput = {
        brandName: brandName,
        primaryColor: primaryColor,
        brandTone: brandTone || "professional and approachable",
        ...input,
      };
    } else if (agentType === "video_generator") {
      resolvedInput = {
        brandName: brandName,
        primaryColor: primaryColor,
        brandTone: brandTone || "professional and approachable",
        ...input,
      };
    }

    try {
      const taskId = await ctx.runMutation(api.agentTasks.submitTask, {
        brandId: brandId as any,
        agentType,
        label,
        input: resolvedInput,
        initiatedFrom: "brand_agent",
        threadId: threadId,
      });

      return {
        status: "dispatched",
        taskId,
        message: `Task started successfully. The user can track it in the Creative Studio tab or ask you for status updates.`,
      };
    } catch (error: any) {
      return {
        status: "error",
        message: `Failed to start the task: ${error.message}`,
      };
    }
  },
});

// ─── Tool: checkTaskStatus ────────────────────────────────────────────────────
// Lets the Brand Agent query recent tasks for the brand - for cross-context awareness.
const checkTaskStatus = createTool({
  description:
    "Checks the status of recent agent tasks for this brand. " +
    "Call this when the user asks about the progress of a generation task, " +
    "or to find out if any tasks are pending or completed. " +
    "You can filter by agentType (e.g. 'character_designer') or leave it blank for all recent tasks.",
  inputSchema: z.object({
    brandId: z.string().describe("The Convex document ID of the brand"),
    agentType: z
      .string()
      .optional()
      .describe("Optional: filter by agent type, e.g. 'character_designer'"),
    limit: z
      .number()
      .optional()
      .describe("Optional: max number of tasks to return (default 5)"),
  }),
  execute: async (ctx, args: any): Promise<any> => {
    const { brandId, agentType, limit } = args as {
      brandId: string;
      agentType?: string;
      limit?: number;
    };

    const tasks = await ctx.runQuery(api.agentTasks.listRecentTasks, {
      brandId: brandId as any,
      agentType,
      limit: limit ?? 5,
    });

    if (!tasks || tasks.length === 0) {
      return agentType
        ? `No recent ${agentType.replace(/_/g, " ")} tasks found for this brand.`
        : "No recent agent tasks found for this brand.";
    }

    let summary = `Found ${tasks.length} recent task(s):\n\n`;
    tasks.forEach((task: any) => {
      const statusLabel = {
        pending: "⏳ Queued",
        running: "🔄 Generating",
        completed: "✅ Completed",
        failed: "❌ Failed",
      }[task.status as string] || task.status;

      summary += `- ${task.label} [${statusLabel}]\n`;
      if (task.status === "completed" && task.output?.imageUrl) {
        summary += `  Result URL: ${task.output.imageUrl}\n`;
      }
      if (task.status === "failed" && task.error) {
        summary += `  Error: ${task.error}\n`;
      }
      summary += `  Initiated from: ${task.initiatedFrom} at ${new Date(task.createdAt).toLocaleTimeString()}\n`;
    });

    summary += `\nSYSTEM INSTRUCTION: Translate these statuses naturally to the user. Do not copy the raw output. Use warm, conversational language.`;
    return summary;
  },
});

// ─── Specialized agents block - appended to core instructions ─────────────────
// Kept as placeholder - all specialized agent behavior is now inlined into the unified prompt below.
const SPECIALIZED_AGENTS_INSTRUCTIONS = ``;

// ─── Core Brand Agent instructions ──────────────────────────────────────────
const CORE_INSTRUCTIONS = `
You are Brandcom - SIRz's creative and strategic brand partner. You talk naturally, never like a system.

<routing>
FIRST, classify the user's message and pick ONE route. Do NOT mix routes.

ROUTE 1 - Greeting / small talk: "hi", "hello", "hey", "how are you"
  → Respond warmly in 1-2 sentences. Do NOT call any tools.

ROUTE 2 - Brand identity / knowledge questions: "what's my brand", "what products do I have", "what's my tone"
  → Answer from the BRAND CONTEXT block provided. Call listBrandProducts only if user asks to browse products.

ROUTE 3 - Campaign templates / ideas: "what templates", "give me ideas", "what can I run"
  → Call getBrandTemplates. Present 2-3 templates using EXACT names from the tool. Remember their IDs.

ROUTE 4 - Template details: "tell me more about X", "what's in Summer Drop"
  → Call getTemplateDetails with the template ID you remembered.

ROUTE 5 - Launch a template: "launch X", "use that", "set up Summer Drop", "yes do it"
  → Call createFullCampaign with the brandTemplateId. After it returns, tell the user it's ready to review and add [view-campaign:ID|Name] on its own line.

ROUTE 6 - Build campaign from scratch: "I want to plan a campaign for X", "create a campaign", "you pick everything"
  → Step A (this turn): Propose the full plan in TEXT ONLY. Do NOT call createFullCampaign yet.

     BEFORE writing the proposal:
     a. Call listBrandProducts to get the actual imageUrl for the product. You need the REAL URL - never use placeholder text.
     b. If any angle will be UGC, call listAmbassadors to pick the ambassador you'll commit to.

     Then use this structure:
     1. **Campaign Name** (one line)
     2. **Product** - name + render the image using the ACTUAL URL from listBrandProducts: \`![Product Name](https://real-url-from-tool)\`. If no image URL is in the tool response, omit the image line entirely - DO NOT write placeholder text like "(replace with actual image URL)".
     3. **Target Audience** (one line)
     4. **Angles** (numbered list with **name**, hook (quoted), script outline, format)
     5. **Ambassador** - if any angle is UGC, name the ambassador you'll use (e.g. "I'll use **Jake** for the UGC spots")
     End by asking "Want me to set this up?"
  → Step B (NEXT turn, after user approves): Call listAmbassadors if needed (skip if you already did in Step A), then createFullCampaign. Respond briefly with confirmation + [view-campaign:ID|Name].
  → When user asks to TWEAK (e.g., "change angle 3", "make it more X"): adjust only what they asked. Keep the rest unchanged. Re-propose with the edit highlighted. Stay in Step A until user explicitly approves.
  → CRITICAL: Never propose and create in the same turn. The user MUST explicitly approve before the tool call.

ROUTE 7 - Campaign status / how's it going: "how's it going", "any updates", "what's happening with X"
  → If a specific campaign is in the CURRENT PAGE CONTEXT, call getCampaignStatus with THAT campaignId.
  → Otherwise, call getCampaignStatus with no campaignId for an overview.
  → ALWAYS use \`campaign.status\` from the tool response. NEVER infer status from task counts. Use the \`summary\` field verbatim or lightly rephrase it.

ROUTE 8 - Posts / analytics: "any posts scheduled", "how did my post do", "analytics"
  → Call getScheduledPostsAndAnalytics with the right filter.
  → When reporting a post's date, include BOTH date and time (e.g. "April 15 at 8:32 PM"). Convert ISO timestamps to natural formatting - don't output raw ISO strings.
  → The tool truncates captions at 80 chars with "…" - display exactly as returned, no need to re-truncate.

ROUTE 9 - Asset generation (image/video/character): "generate an image of X", "make a video of Y"
  → Gather required inputs (see <generation_flow>). Call dispatchToSpecializedAgent. Then give a brief natural confirmation like "I've started that - it usually takes about a minute."
  → NEVER dispatch if any required field is missing. Ask for it first.

ROUTE 10 - Scheduling / publishing / modifying live campaigns: "schedule this", "publish now", "post this"
  → Refuse politely. Say you can't schedule or publish directly, and direct them to the campaign details page.
</routing>

<voice>
- Helpful, concise, conversational. Like a creative partner, not a system.
- Never narrate your own tool calls ("let me fetch...", "I'll check..."). Just do it and respond.
- Never expose database IDs, field names, tool names, or internal architecture.
- Keep responses short. Use bullets only for 3+ items.
- Refer to the brand by name when relevant.
</voice>

<critique_mode>
When the user asks what you think, whether something's good, or for your honest opinion on creative work (angles, hooks, campaigns, copy):

Act like an experienced creative director giving real feedback - not a cheerleader.

- Call out BOTH strengths and specific weaknesses. Every piece of creative has flaws.
- Be specific: "the hook 'First light, fresh lines.' is 4 words - too vague. Compare to 'Local Pro's Sunrise Secret' which has character."
- Suggest concrete improvements, not generalities. Bad: "it could be punchier." Good: "try 'Dawn patrol or die' - sharper, has attitude, fits the irreverent tone."
- If something is actually weak, say so. "The first hook is generic. Every snowboard ad could say that. Not your brand's voice."
- Don't default to "these are great!" If they're mixed quality, say so.
- End with a clear recommendation: launch as-is, tweak X first, or replace Y.

You are NOT a yes-person. The user is asking for your judgment because they trust it. Give it.
</critique_mode>

<generation_flow>
Available specialized agents: character_designer, image_generator, video_generator.

Before dispatching an image or video:
1. Call listBrandAssets to get the brand character (include in assetReferences as type "character").
2. If user mentioned a product, call listBrandProducts with a search term and include it in assetReferences (use the exact id and imageUrl from the response - never invent IDs).
3. For missing optional fields, use sensible defaults silently. Don't ask questions for optional stuff.

Required fields by agent:
- character_designer: stylePreference is REQUIRED ("3D render", "photorealistic", etc.). Other fields optional.
- image_generator: prompt REQUIRED. Infer style from user's words (lifestyle/product shot/ugc/cinematic).
- video_generator: prompt REQUIRED. Infer videoStyle from user's words. Default duration 5s.

After dispatch: give a brief natural confirmation. The user can track progress in their notifications.
</generation_flow>

<campaign_rules>
- Templates: use EXACT names from getBrandTemplates output. Never invent names.
- When launching a template, call createFullCampaign with just the brandTemplateId - the tool merges the template's prefill data automatically.
- When creating from scratch, gather product + audience first, then call createFullCampaign with populated products and selectedAngles.
- You may create campaigns in DRAFT state only. You cannot schedule posts, publish, or modify scheduled/active/completed campaigns.

ANGLE QUALITY (critical - you are responsible for the creative content):
When you include angles in createFullCampaign, you MUST provide complete creative content. Don't submit angles with just a name - write all fields:
- \`name\`: short, punchy angle concept (e.g. "Adventure Awaits", "Unleash Your Potential")
- \`hook\`: a full attention-grabbing opening line that a viewer would hear in the first 2 seconds of the ad. Should be specific, vivid, and emotional - NOT just the angle name repeated. Example: "This isn't just a snowboard. This is your ticket to the next mountain you've been dreaming about."
- \`scriptOutline\`: 2-4 sentence structure for the full video ad. Describe scenes/beats, visual ideas, pacing. Example: "Open on fresh powder at sunrise. Cut to rider strapping in, breath visible in the cold. Wide shot of first carve, spraying snow. Close on rider's grin. End frame: product + tagline."
- \`format\`: "Product Ads" OR "AI UGC Ads" - see FORMAT DECISION below

You are the creative director - write angles as if briefing a video production team. Empty or generic fields produce bad ads.

FORMAT DECISION (READ CAREFULLY - this is the #1 mistake to avoid):
You are NOT a default-Product-Ads agent. You must consciously pick each angle's format.

BEFORE assigning formats, explicitly check the brand's tone and audience from BRAND CONTEXT:
- Tone contains any of: "fun", "energetic", "vibrant", "irreverent", "casual", "playful", "authentic", "friendly" → BRAND IS UGC-FRIENDLY
- Tone contains any of: "premium", "luxury", "refined", "sophisticated", "technical", "minimalist" → BRAND IS PRODUCT-AD-FRIENDLY
- Tone is neutral/unknown → default to MIXED

Once you classify the brand:
- UGC-friendly brand → minimum 2 out of 3 angles should be "AI UGC Ads"
- Product-ad-friendly brand → minimum 2 out of 3 angles should be "Product Ads"
- Mixed/neutral brand → 50/50 split

Per-angle format choice (apply within the quota above):
- "AI UGC Ads" suits: first-person stories, testimonials, relatable problems, community moments, "I used to think..." narratives
- "Product Ads" suits: product hero shots, feature demos, aspirational montages, cinematic product-forward spots

HARD RULE: If the brand tone contains "fun", "energetic", "vibrant", "irreverent", or "casual", you MUST NOT create a campaign with 0 UGC angles. Doing so directly contradicts the brand voice.

SELECTED TYPES:
- Include selectedTypes that match the formats of your angles. If you have both formats, include both. If all angles share one format, include just that one.

AMBASSADOR SELECTION (critical when UGC is involved):
- Whenever your angles include any "AI UGC Ads", you MUST set \`ambassadorId\` on createFullCampaign. UGC ads without an ambassador fail downstream.
- Call listAmbassadors to see available options.
- PRIORITY ORDER for picking:
  1. If brand has a custom ambassador marked \`isPreferred: true\` AND \`type: "custom"\` - use it (this is the brand's own ambassador - always first choice).
  2. Otherwise, pick ANY custom ambassador whose niche fits the brand.
  3. Only fall back to a preset ambassador if the brand has no custom ambassadors at all.
- Rationale: custom ambassadors are tailored to this specific brand. Presets are generic. Always prefer custom.
- If there are zero ambassadors available, tell the user they need to create one first - do NOT include UGC angles.
- Pure Product Ads campaigns don't need an ambassador - leave ambassadorId undefined.

PRODUCT TARGET AUDIENCE:
- When writing \`products[].targetAudience\`, use the brand's existing demographic format: "{gender} aged {ageRange} interested in {interests joined by comma}".
- Example: "male aged 25-34 interested in Sports, Fitness, Travel"
- This matches what the rest of the platform uses - stay consistent with the brand template format. Don't invent a different style.

UI Action markers (invisible to user, rendered as buttons):
- After creating or referencing a specific campaign: [view-campaign:CAMPAIGN_ID|CAMPAIGN_NAME] on its own line.
- When suggesting platform connection: [connect-platform] on its own line.
</campaign_rules>

<format>
- Use **bold** for names and key numbers.
- Short paragraphs, max 2-3 sentences each.
- Bullet points only for genuine lists of 3+ items.
- The action marker [view-campaign:ID|Name] is the ONLY place an ID may appear. Never mention IDs in prose.
- State only facts from the tool response. Do not invent details, themes, or aesthetics the tool didn't return.
</format>

<error_handling>
- If a tool returns \`{ error: "..." }\`: tell the user naturally what went wrong. Example: "I couldn't find that campaign - maybe it was deleted?"
- If a tool returns empty (e.g., templates: []): explain honestly. "Your templates are still being generated - check back shortly." Never invent fake results.
- If you're missing info to proceed (e.g., user says "launch it" with no prior template list): ask them to clarify which one.
- If you realize mid-response you're going wrong, stop and ask a clarifying question instead of guessing.
- If a tool call fails with a validation or technical error: retry ONCE silently with corrected args. Do NOT narrate the retry. If it fails twice, tell the user simply: "Something went wrong setting that up. Try again or I can help differently."
- NEVER send two separate responses for one user message. Combine your retry and final answer into ONE response.
</error_handling>

<examples>
Example 1 - User is viewing a campaign and asks vague status question:
User: "how's it going?"
(page_context shows user is viewing campaign "Shred Fuel" id abc123, status=active)
[Tool call: getCampaignStatus({ brandId: "...", campaignId: "abc123" })]
[Tool returns: { summary: "Campaign 'Shred Fuel' is active - posts are going out. Posts: 1 published, 1 scheduled. Analytics: 500 views.", campaign: { status: "active" }, ... }]
Response: "**Shred Fuel** is running well - 1 post has gone out with **500 views** so far, and 1 more is scheduled. Want to dig into the numbers?
[view-campaign:abc123|Shred Fuel]"

Example 2 - User asks for templates:
User: "what templates do you have for me?"
[Tool call: getBrandTemplates({ brandId: "..." })]
[Tool returns: { templates: [{ id: "t1", name: "Summer Drop", description: "...", ... }, { id: "t2", name: "Weekend Flash Sale", description: "...", ... }] }]
Response: "I found two campaigns tailored to your brand:

**Summer Drop** - Launch your new line with seasonal urgency. Includes 2 Product Ads and 2 UGC angles.

**Weekend Flash Sale** - Drive quick conversions with a time-limited offer.

Which one catches your eye? I can launch either for you."
(Remember: t1 = Summer Drop, t2 = Weekend Flash Sale, for follow-up)

Example 3 - User asks to launch a template after seeing the list:
User: "launch Summer Drop"
(Based on previous turn, Summer Drop has id "t1")
[Tool call: createFullCampaign({ brandId: "...", name: "Summer Drop", brandTemplateId: "t1" })]
[Tool returns: { campaignId: "c99", status: "draft", name: "Summer Drop", productsCount: 1, anglesCount: 4 }]
Response: "Done - I've set up **Summer Drop** for you. It's ready to review and launch.
[view-campaign:c99|Summer Drop]"

Example 3b - User approves a from-scratch campaign you proposed (brand is fun/energetic, targeting 25-34 male sports/fitness):
(Previous turn: you proposed 3 angles for The Draft Snowboard - 2 UGC, 1 Product - matching brand tone)
User: "yes let's go. name it something catchy"
[Tool call: listAmbassadors({ brandId: "..." })]
[Tool returns: { ambassadors: [{ id: "amb_custom_1", name: "Jake", niche: "Adventure sports", type: "custom", isPreferred: true }, { id: "amb_preset_1", name: "Sarah", niche: "Wellness", type: "preset" }], ... }]
(Jake is the brand's custom preferred ambassador - pick him, not a preset)
[Tool call: createFullCampaign({
  brandId: "...",
  name: "Ride the Thrill",
  products: [{ name: "The Draft Snowboard", imageUrl: "https://...", targetAudience: "male aged 25-34 interested in Sports, Fitness, Travel", keyBenefit: "Unmatched performance in deep snow" }],
  ambassadorId: "amb_custom_1",
  selectedTypes: ["Product Ads", "AI UGC Ads"],
  selectedAngles: [
    {
      name: "Unleash Your Potential",
      hook: "I said I'd never drop that cliff. Then I got The Draft.",
      scriptOutline: "POV shot approaching a steep drop. Internal monologue about fear. Cut to board specs on screen. Back to POV - commit to the jump. Clean landing, rider yells. End: 'Your limits just moved.'",
      format: "AI UGC Ads"
    },
    {
      name: "Community Connection",
      hook: "The best runs are the ones you tell stories about for years.",
      scriptOutline: "Group of 4 friends loading car at sunrise. Montage of chair lift rides, high-fives, wipeouts, laughs. Firepit at end of day, boards leaning together. Hero: The Draft in the snow with beer.",
      format: "AI UGC Ads"
    },
    {
      name: "Adventure Awaits",
      hook: "That untouched ridge you've been staring at from Google Earth? Today's the day.",
      scriptOutline: "Open on aerial shot of snowy peaks. Cut to rider checking GPS map on phone. Close-up strapping into The Draft. Wide carve through fresh powder, snow spray. Hero shot of rider at summit with board. End: product on white backdrop.",
      format: "Product Ads"
    }
  ]
})]
[Tool returns: { campaignId: "c42", status: "draft", name: "Ride the Thrill", productsCount: 1, anglesCount: 3 }]
Response: "Done - **Ride the Thrill** is set up with **Jake** as your ambassador. All three angles and The Draft Snowboard featured. Ready to review.
[view-campaign:c42|Ride the Thrill]"

Example 4 - User asks for generic brand info:
User: "what's my brand about?"
(brand_context shows: Name=Nana Cosmetics, Industry=beauty, Tagline="Glow naturally", Tone=warm, Products=12)
Response: "**Nana Cosmetics** is in beauty with a warm, inviting tone - your tagline is \"Glow naturally\". You've got 12 products synced. What would you like to work on?"

Example 5 - User tries to do something you can't:
User: "schedule this campaign for tomorrow"
Response: "I can't schedule posts directly - you'll need to do that from the campaign details page, where you can set times per post and configure TikTok settings. Want me to take you there?
[view-campaign:abc123|Shred Fuel]"

Example 6 - User asks about product pricing:
User: "what is my most expensive product?"
[Tool call: listBrandProducts({ brandId: "..." })]
[Tool returns: { products: [{ title: "Hydrogen Board", priceLabel: "USD 1200", imageUrl: "https://...", ... }, { title: "Basic Snowboard", priceLabel: "USD 400", ... }] }]
Response: "Your most expensive product is the **Hydrogen Board** at **$1,200**.

![Hydrogen Board](https://...)

Want me to see what the others are priced at?"

PRODUCT DISPLAY RULES:
- When showing products, render each image with markdown: ![name](imageUrl) - only ONCE per product. Do NOT repeat the name before and after the image.
- Always include price (from priceLabel field) when relevant to the question.
- Do not invent prices or describe products with attributes not in the tool response.
</examples>
`.trim();

// ─── Campaign Tools for Brand Agent ─────────────────────────────────────────────

const getBrandTemplates = createTool({
  description: "Get personalized campaign templates for this brand. Returns AI-generated templates with pre-filled products, angles, and ambassador suggestions.",
  inputSchema: z.object({
    brandId: z.string().describe("The Convex document ID of the brand"),
  }),
  execute: async (ctx, args: any): Promise<any> => {
    try {
      const result: any = await ctx.runQuery(internal.campaignTemplates.listTemplatesForAgent, {
        brandId: args.brandId as any,
      });

      if (!result || result.templates.length === 0) {
        return {
          templates: [],
          message: "No templates available yet - your personalized templates are still being generated. Check back shortly.",
        };
      }

      if (result.type === "base") {
        return {
          templates: result.templates.slice(0, 5).map((t: any) => ({
            id: t._id,
            name: t.name,
            description: t.description,
            hooks: t.sampleHooks?.slice(0, 2) || [],
            types: t.suggestedTypes,
            anglesCount: t.suggestedAngles.length,
            category: t.category || "general",
            isBrandPersonalized: false,
          })),
          message: `Found ${Math.min(result.templates.length, 5)} general templates (personalized ones are being generated)`,
        };
      }

      // Brand templates - sort by seasonal relevance + recency
      const now = Date.now();
      const templates = [...result.templates].sort((a: any, b: any) => {
        const aScore = (a.seasonalTrigger && a.seasonalTrigger.activeFrom <= now && a.seasonalTrigger.activeTo >= now) ? 1000 : 0;
        const bScore = (b.seasonalTrigger && b.seasonalTrigger.activeFrom <= now && b.seasonalTrigger.activeTo >= now) ? 1000 : 0;
        return (bScore - aScore) || (b.createdAt - a.createdAt);
      });

      return {
        templates: templates.slice(0, 5).map((t: any) => ({
          id: t._id,
          name: t.name,
          description: t.description,
          hooks: t.personalizedHooks?.slice(0, 2) || [],
          hasProduct: !!t.prefillData?.productName,
          productName: t.prefillData?.productName || null,
          types: t.prefillData?.suggestedTypes || [],
          anglesCount: t.prefillData?.suggestedAngles?.length || 0,
          hasAmbassador: !!t.prefillData?.suggestedAmbassadorId,
          category: t.category || "general",
          seasonalEvent: t.seasonalTrigger?.name || null,
          isBrandPersonalized: true,
        })),
        message: `Found ${Math.min(templates.length, 5)} personalized templates for your brand`,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[getBrandTemplates] ERROR:`, msg, error);
      return { error: msg };
    }
  },
});

const getTemplateDetails = createTool({
  description: "Get full details of a specific campaign template - all personalized hooks, individual angles with their names and script outlines, ambassador info, and product details. Use this when the user asks to 'tell me more', 'show details', or 'what's in this template'.",
  inputSchema: z.object({
    templateId: z.string().describe("The template ID (brandCampaignTemplate or campaignTemplate)"),
  }),
  execute: async (ctx, args: any): Promise<any> => {
    try {
      const result: any = await ctx.runQuery(internal.campaignTemplates.getAnyTemplate, {
        templateId: args.templateId,
      });

      if (!result?.template) return { error: "Template not found" };

      const t = result.template;
      const ambassador = result.ambassador;

      // Brand template (has prefillData + personalizedHooks)
      if ("prefillData" in t) {
        const pf = t.prefillData;
        return {
          id: t._id,
          name: t.name,
          description: t.description,
          allHooks: t.personalizedHooks || [],
          category: t.category || "general",
          seasonalEvent: t.seasonalTrigger?.name || null,
          product: pf?.productName ? { name: pf.productName, imageUrl: pf.productImageUrl } : null,
          targetAudience: pf?.targetAudience || null,
          videoStyle: pf?.videoStyle || null,
          types: pf?.suggestedTypes || [],
          angles: (pf?.suggestedAngles || []).map((a: any) => ({
            name: a.name, hook: a.hook, scriptOutline: a.scriptOutline, format: a.format,
          })),
          ambassador,
          isBrandPersonalized: true,
        };
      }

      // Base campaign template
      if ("suggestedAngles" in t) {
        return {
          id: t._id,
          name: t.name,
          description: t.description,
          allHooks: t.sampleHooks || [],
          category: t.category || "general",
          types: t.suggestedTypes,
          angles: t.suggestedAngles.map((name: string) => ({ name })),
          isBrandPersonalized: false,
        };
      }

      return { error: "Template not found" };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[getTemplateDetails] ERROR:`, msg, error);
      return { error: msg };
    }
  },
});

const createFullCampaign = createTool({
  description: "Create a fully populated campaign. Can launch from a brand template (pass brandTemplateId) or create from scratch with provided details.",
  inputSchema: z.object({
    brandId: z.string().describe("The Convex document ID of the brand"),
    name: z.string().describe("Campaign name"),
    description: z.string().optional().describe("Campaign description"),
    brandTemplateId: z.string().optional().describe("Brand template ID to launch from - merges prefill data"),
    products: z.array(z.object({
      name: z.string(),
      shopifyProductId: z.string().optional(),
      imageUrl: z.string().optional(),
      targetAudience: z.string().optional(),
      keyBenefit: z.string().optional(),
    })).optional().describe("Products featured in the campaign"),
    ambassadorId: z.string().optional().describe("Ambassador ID to use for UGC content"),
    selectedTypes: z.array(z.string()).optional().describe("Video types: 'Product Ads' and/or 'AI UGC Ads'"),
    selectedAngles: z.array(z.object({
      name: z.string().describe("Angle name (required)"),
      hook: z.string().optional().describe("Attention-grabbing opening line"),
      scriptOutline: z.string().optional().describe("Brief script outline for the video"),
      format: z.string().optional().describe("'Product Ads' or 'AI UGC Ads' - defaults to 'Product Ads' if omitted"),
      id: z.string().optional().describe("Unique identifier - auto-generated if omitted"),
    })).optional().describe("Creative angles with hooks and script outlines"),
    targetPlatforms: z.array(z.string()).optional().describe("Target platforms like 'tiktok', 'instagram'"),
  }),
  execute: async (ctx, args: any): Promise<any> => {
    try {
      console.log(`[createFullCampaign] called with args:`, JSON.stringify({
        brandId: args.brandId,
        name: args.name,
        brandTemplateId: args.brandTemplateId,
        productsCount: args.products?.length ?? 0,
        anglesCount: args.selectedAngles?.length ?? 0,
        types: args.selectedTypes,
      }));

      // If launching from a brand template and the agent didn't provide angles/products, hydrate from prefill
      let mergedProducts = args.products;
      let mergedAngles = args.selectedAngles;
      let mergedTypes = args.selectedTypes;
      let mergedAmbassadorId = args.ambassadorId;

      if (args.brandTemplateId) {
        const result: any = await ctx.runQuery(internal.campaignTemplates.getAnyTemplate, {
          templateId: args.brandTemplateId,
        });
        const template = result?.template;
        if (template?.prefillData) {
          const pf = template.prefillData;
          if ((!mergedProducts || mergedProducts.length === 0) && pf.productName) {
            mergedProducts = [{ name: pf.productName, imageUrl: pf.productImageUrl }];
          }
          if (!mergedAngles || mergedAngles.length === 0) mergedAngles = pf.suggestedAngles || [];
          if (!mergedTypes || mergedTypes.length === 0) mergedTypes = pf.suggestedTypes || [];
          if (!mergedAmbassadorId && pf.suggestedAmbassadorId) mergedAmbassadorId = pf.suggestedAmbassadorId;
        }
      }

      // Sanitize products - drop shopifyProductId (AI can't reliably know Convex IDs)
      const products = (mergedProducts || []).map((p: any) => ({
        name: p.name,
        shopifyProductId: undefined,
        imageUrl: p.imageUrl || undefined,
        targetAudience: p.targetAudience || undefined,
        keyBenefit: p.keyBenefit || undefined,
        problemSolved: p.problemSolved || undefined,
      }));

      // Normalize angles - auto-generate IDs, fill empty strings for missing text fields, normalize format
      const selectedAngles = (mergedAngles || []).map((a: any, i: number) => ({
        id: a.id || `angle_${Date.now()}_${i}`,
        name: a.name || `Angle ${i + 1}`,
        hook: a.hook || "",
        scriptOutline: a.scriptOutline || "",
        format: (a.format === "AI UGC Ads" ? "AI UGC Ads" : "Product Ads") as "Product Ads" | "AI UGC Ads",
      }));

      // Derive types from angles if not specified
      let selectedTypes = mergedTypes || [];
      if (selectedAngles.length > 0 && selectedTypes.length === 0) {
        selectedTypes = [...new Set(selectedAngles.map((a: any) => a.format))];
      }
      if (selectedTypes.length === 0) selectedTypes = ["Product Ads"];

      // Validate ambassadorId if provided - must be a real Convex ambassadors ID
      let validAmbassadorId: any = undefined;
      if (mergedAmbassadorId) {
        try {
          const amb: any = await ctx.runQuery(api.ambassadors.getAmbassador, {
            ambassadorId: mergedAmbassadorId as any,
          });
          if (amb) validAmbassadorId = mergedAmbassadorId;
        } catch {
          // Invalid ID format - ignore silently
        }
      }

      // Call the existing createCampaign mutation (it has proper auth + validation)
      const campaignId: any = await ctx.runMutation(api.campaigns.createCampaign, {
        brandId: args.brandId as any,
        name: args.name,
        description: args.description,
        campaignType: args.brandTemplateId ? "from_template" : "copilot_generated",
        brandTemplateId: args.brandTemplateId as any,
        products,
        ambassadorId: validAmbassadorId,
        selectedTypes,
        selectedAngles,
        targetPlatforms: args.targetPlatforms,
      });

      console.log(`[createFullCampaign] created campaign ${campaignId}`);

      return {
        campaignId,
        status: "draft",
        name: args.name,
        productsCount: products.length,
        anglesCount: selectedAngles.length,
        types: selectedTypes,
        message: `Campaign "${args.name}" created with ${products.length} product(s) and ${selectedAngles.length} angle(s). Ready to review.`,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[createFullCampaign] ERROR:`, msg, error);
      return {
        error: msg,
        message: `Failed to create campaign: ${msg}`,
      };
    }
  },
});

const getCampaignStatus = createTool({
  description: "Get status of campaigns. Without campaignId: returns overview of all recent campaigns. With campaignId: returns detailed status including generation progress, posts, and analytics.",
  inputSchema: z.object({
    brandId: z.string().describe("The Convex document ID of the brand"),
    campaignId: z.string().optional().describe("Specific campaign ID for detail mode, omit for overview of all campaigns"),
  }),
  execute: async (ctx, args: any): Promise<any> => {
    try {
      if (args.campaignId) {
        const result: any = await ctx.runQuery(internal.campaigns.getCampaignStatusInternal, {
          campaignId: args.campaignId,
        });
        if (!result?.campaign) return { error: "Campaign not found" };

        const { campaign, tasks, posts } = result;
        const videoTasks = tasks.filter((t: any) => t.agentType === "video_generator");
        const postedPosts = posts.filter((p: any) => p.status === "posted");
        const totalViews = postedPosts.reduce((s: number, p: any) => s + (p.analytics?.views || 0), 0);
        const totalLikes = postedPosts.reduce((s: number, p: any) => s + (p.analytics?.likes || 0), 0);

        const completedVideos = videoTasks.filter((t: any) => t.status === "completed").length;
        const failedVideos = videoTasks.filter((t: any) => t.status === "failed").length;
        const runningVideos = videoTasks.filter((t: any) => t.status === "running" || t.status === "pending").length;
        const scheduledCount = posts.filter((p: any) => p.status === "scheduled").length;
        const failedPostsCount = posts.filter((p: any) => p.status === "failed").length;

        const statusLabel: Record<string, string> = {
          draft: "in draft (not yet launched)",
          generating: "generating videos",
          ready: "ready - videos generated and waiting to be scheduled",
          failed: "failed during generation",
          scheduled: "scheduled - waiting for posts to go out",
          active: "active - posts are going out and performing",
          completed: "completed - all posts have been published",
        };
        const summary = `Campaign "${campaign.name}" is ${statusLabel[campaign.status] || campaign.status}. ${
          videoTasks.length > 0 ? `Generated ${completedVideos} of ${videoTasks.length} videos${failedVideos > 0 ? ` (${failedVideos} failed)` : ''}. ` : ''
        }${
          posts.length > 0 ? `Posts: ${postedPosts.length} published, ${scheduledCount} scheduled${failedPostsCount > 0 ? `, ${failedPostsCount} failed` : ''}. ` : ''
        }${
          postedPosts.length > 0 ? `Analytics: ${totalViews} total views, ${totalLikes} total likes.` : ''
        }`.trim();

        return {
          summary,
          campaign: {
            name: campaign.name,
            status: campaign.status,
            statusLabel: statusLabel[campaign.status] || campaign.status,
            createdAt: campaign.createdAt,
            productsCount: campaign.products?.length || 0,
            anglesCount: campaign.selectedAngles?.length || 0,
          },
          generation: { total: videoTasks.length, completed: completedVideos, failed: failedVideos, running: runningVideos },
          posts: { scheduled: scheduledCount, posted: postedPosts.length, failed: failedPostsCount },
          analytics: { totalViews, totalLikes },
        };
      }

      // Overview mode
      const campaigns: any[] = await ctx.runQuery(internal.campaigns.listBrandCampaignsInternal, {
        brandId: args.brandId as any,
      });

      const statusCounts: Record<string, number> = {};
      for (const c of campaigns) {
        statusCounts[c.status] = (statusCounts[c.status] || 0) + 1;
      }

      const recent = campaigns
        .sort((a: any, b: any) => b.createdAt - a.createdAt)
        .slice(0, 10);

      return {
        overview: {
          totalCampaigns: campaigns.length,
          statusCounts,
          campaigns: recent.map((c: any) => ({
            id: c._id,
            name: c.name,
            status: c.status,
            productsCount: c.products?.length || 0,
            anglesCount: c.selectedAngles?.length || 0,
            createdAt: c.createdAt,
          })),
        },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[getCampaignStatus] ERROR:`, msg, error);
      return { error: msg };
    }
  },
});

const getScheduledPostsAndAnalytics = createTool({
  description: "Get scheduled posts, published post performance, and failed post details for a brand. Use filter: 'upcoming' for scheduled, 'posted' for published with analytics, 'failed' for errors, or 'all'.",
  inputSchema: z.object({
    brandId: z.string().describe("The Convex document ID of the brand"),
    filter: z.string().optional().describe("'upcoming' | 'posted' | 'failed' | 'all' (default 'all')"),
  }),
  execute: async (ctx, args: any): Promise<any> => {
    try {
      const allPosts: any[] = await ctx.runQuery(internal.scheduledPosts.listPostsByBrandWithCampaignNames, {
        brandId: args.brandId as any,
      });

      const filter = args.filter || "all";
      let filtered = allPosts;
      if (filter === "upcoming") filtered = allPosts.filter((p: any) => p.status === "scheduled");
      else if (filter === "posted") filtered = allPosts.filter((p: any) => p.status === "posted");
      else if (filter === "failed") filtered = allPosts.filter((p: any) => p.status === "failed");

      filtered.sort((a: any, b: any) => {
        if (a.status === "scheduled" && b.status === "scheduled") return a.scheduledAt - b.scheduledAt;
        return (b.postedAt || b.createdAt) - (a.postedAt || a.createdAt);
      });
      filtered = filtered.slice(0, 10);

      const posts = filtered.map((p: any) => {
        const caption = p.caption || "";
        const captionPreview = caption.length > 80 ? caption.slice(0, 80).trimEnd() + "…" : caption;
        return {
          platform: p.platform,
          status: p.status,
          campaignName: p.campaignName,
          caption: captionPreview,
          scheduledAt: p.status === "scheduled" ? new Date(p.scheduledAt).toISOString() : undefined,
          postedAt: p.postedAt ? new Date(p.postedAt).toISOString() : undefined,
          analytics: p.analytics ? {
            views: p.analytics.views,
            likes: p.analytics.likes,
            comments: p.analytics.comments,
            shares: p.analytics.shares,
          } : undefined,
          error: p.status === "failed" ? p.error : undefined,
        };
      });

      return {
        summary: {
          scheduled: allPosts.filter((p: any) => p.status === "scheduled").length,
          posted: allPosts.filter((p: any) => p.status === "posted").length,
          failed: allPosts.filter((p: any) => p.status === "failed").length,
        },
        posts,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[getScheduledPostsAndAnalytics] ERROR:`, msg, error);
      return { error: msg };
    }
  },
});

const analyzePastCampaigns = createTool({
  description: "Analyze campaign history with performance data. Returns status distribution, per-campaign analytics, and overall metrics.",
  inputSchema: z.object({
    brandId: z.string().describe("The Convex document ID of the brand"),
  }),
  execute: async (ctx, args): Promise<any> => {
    try {
      const campaigns: any[] = await ctx.runQuery(
        internal.campaigns.listBrandCampaignsInternal,
        {
          brandId: args.brandId as any,
        }
      );

      const statusCounts: Record<string, number> = {};
      for (const c of campaigns) {
        statusCounts[c.status] = (statusCounts[c.status] || 0) + 1;
      }

      const performanceCampaigns = campaigns
        .filter(
          (c: any) =>
            c.status === "active" || c.status === "completed"
        )
        .sort((a: any, b: any) => b.createdAt - a.createdAt)
        .slice(0, 5);

      let totalViewsAll = 0;
      let totalPostsAll = 0;

      const campaignPerformance = await Promise.all(
        performanceCampaigns.map(async (c: any) => {
          const result: any = await ctx.runQuery(
            internal.campaigns.getCampaignStatusInternal,
            {
              campaignId: c._id,
            }
          );

          const posts = result?.posts || [];

          const postedPosts = posts.filter(
            (p: any) => p.status === "posted"
          );

          const views = postedPosts.reduce(
            (s: number, p: any) =>
              s + (p.analytics?.views || 0),
            0
          );

          const likes = postedPosts.reduce(
            (s: number, p: any) =>
              s + (p.analytics?.likes || 0),
            0
          );

          totalViewsAll += views;
          totalPostsAll += postedPosts.length;

          return {
            name: c.name,
            status: c.status,
            postsCount: postedPosts.length,
            totalViews: views,
            totalLikes: likes,
          };
        })
      );

      return {
        totalCampaigns: campaigns.length,
        statusCounts,
        campaignPerformance,
        overall: {
          totalViews: totalViewsAll,
          totalPosts: totalPostsAll,
          avgViewsPerPost:
            totalPostsAll > 0
              ? Math.round(totalViewsAll / totalPostsAll)
              : 0,
        },
      };
    } catch (error) {
      const msg =
        error instanceof Error
          ? error.message
          : String(error);

      console.error(
        `[analyzePastCampaigns] ERROR:`,
        msg,
        error
      );

      return { error: msg };
    }
  },
});

// ─── Campaign Instructions ──────────────────────────────────────────────────
// All campaign logic is now in the unified CORE_INSTRUCTIONS above (see <routing> and <campaign_rules>).
const CAMPAIGN_INSTRUCTIONS = ``;

// ─── Brand Agent definition ──────────────────────────────────────────────────
// Temperature 0 for deterministic tool routing - critical for multi-tool agents.
// See https://platform.openai.com/docs/guides/function-calling for rationale.
export const brandAgent = new Agent(components.agent, {
  name: "Brand Agent",
  languageModel: openrouter.chat(MODEL) as any,
  instructions: CORE_INSTRUCTIONS,
  tools: {
    listBrandProducts,
    listBrandAssets,
    listAmbassadors,
    dispatchToSpecializedAgent,
    checkTaskStatus,
    getBrandTemplates,
    getTemplateDetails,
    createFullCampaign,
    getCampaignStatus,
    getScheduledPostsAndAnalytics,
    analyzePastCampaigns,
  },
  callSettings: {
    temperature: 0,
  } as any,
  maxSteps: 8,
});

// ─── Mutation: getOrCreateThread ──────────────────────────────────────────────
export const getOrCreateThread = mutation({
  args: { brandId: v.id("brands") },
  handler: async (ctx, args): Promise<string> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    const userId = identity.subject.split('|')[0];

    const existing = await ctx.runQuery(api.brands.getThreadId, {
      brandId: args.brandId,
      userId: userId as any,
    }) as { threadId?: string } | null;

    if (existing && existing.threadId) {
       return existing.threadId;
    }

    const { threadId } = await brandAgent.createThread(ctx, { userId });

    await ctx.runMutation(api.brands.saveThreadId, {
      brandId: args.brandId,
      userId: userId as any,
      threadId,
    });

    return threadId as string;
  },
});

// ─── Action: pushTaskNotification ─────────────────────────────────────────────
// Creates an in-app notification when a task completes.
// Called from the fal.ai webhook handler when a generation task finishes.
export const pushTaskNotification = action({
  args: {
    userId: v.string(),
    brandId: v.id("brands"),
    taskId: v.id("agentTasks"),
    taskLabel: v.string(),
    output: v.any(),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<void> => {
    // Build notification content
    let title: string;
    let message: string;
    let type: string;
    let link: string | undefined;

    if (args.error) {
      title = "Task Failed";
      message = `"${args.taskLabel}" failed: ${args.error}`;
      type = "task_failed";
    } else if (args.output) {
      const output = args.output;
      title = "Task Complete!";
      type = "task_completed";
      
      if (output.imageUrl) {
        message = `"${args.taskLabel}" is ready! Click to view.`;
        link = `/library?taskId=${args.taskId}`;
      } else if (output.videoUrl) {
        message = `"${args.taskLabel}" is ready! Click to view.`;
        link = `/library?taskId=${args.taskId}`;
      } else if (output.characterImageUrl) {
        message = `Your brand character is ready! Click to view.`;
        link = `/library?taskId=${args.taskId}`;
      } else {
        message = `"${args.taskLabel}" has completed.`;
        link = `/library?taskId=${args.taskId}`;
      }
    } else {
      title = "Task Updated";
      message = `"${args.taskLabel}" status updated.`;
      type = "task_updated";
    }

    try {
      // Call the createNotification mutation
      await ctx.runMutation(api.agent.createNotification, {
        userId: args.userId,
        brandId: args.brandId,
        type,
        title,
        message,
        taskId: args.taskId,
        link,
      });
      console.log(`[pushTaskNotification] Notification created for task ${args.taskId}, user ${args.userId}`);
    } catch (error) {
      console.error(`[pushTaskNotification] Failed to create notification:`, error);
    }
  },
});

// ─── Action: copilotChat ─────────────────────────────────────────────────────
export const copilotChat = action({
  args: {
    threadId: v.string(),
    message: v.string(),
    assetReferences: v.optional(v.array(v.object({
      type: v.string(),
      id: v.string(),
      name: v.string(),
      imageUrl: v.optional(v.string()),
      description: v.optional(v.string()),
    }))),
    context: v.optional(v.string()),
    brandId: v.id("brands"),
  },
  handler: async (ctx, args): Promise<void> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const userId = identity.subject.split('|')[0];
    const billing = await ctx.runMutation(internal.billing.reserveSkuOperationInternal, {
      userId,
      brandId: args.brandId,
      featureKey: "helper_ai",
      skuKey: "text.ai_assistant_message",
      units: 1,
      metadata: { source: "brand_agent_chat" },
    });

    const brandContext = await ctx.runQuery(api.brands.getBrandContext, {
      brandId: args.brandId,
    });

    const brandStr = brandContext
      ? [
          `Brand Name: ${brandContext.name || 'N/A'}`,
          `Tagline: ${brandContext.tagline || 'N/A'}`,
          `Industry: ${brandContext.industry || 'N/A'}`,
          `Description: ${brandContext.description || 'N/A'}`,
          `Goal: ${brandContext.goal || 'N/A'}`,
          `Tone: ${brandContext.brandTone || 'N/A'}`,
          `Primary Color: ${brandContext.primaryColor || 'N/A'}`,
          `Country: ${brandContext.countryCode || 'N/A'}`,
          `Website: ${brandContext.websiteUrl || 'N/A'}`,
          `Preferred Platforms: ${brandContext.preferredPlatforms?.join(', ') || 'N/A'}`,
          `Target Demographics: ${brandContext.targetDemographics ? `${brandContext.targetDemographics.ageRange || ''} ${brandContext.targetDemographics.gender || ''} ${brandContext.targetDemographics.interests?.join(', ') || ''}`.trim() || 'N/A' : 'N/A'}`,
          `Ambassador: ${brandContext.ambassador ? `${brandContext.ambassador.name} (${brandContext.ambassador.niche})` : 'None set'}`,
          `Products: ${brandContext.productCount || 0} synced`,
          `Connected Platforms: ${brandContext.connectedPlatforms?.length ? brandContext.connectedPlatforms.join(', ') : 'None'}`,
          `Templates: ${brandContext.templatesStatus === 'ready' ? 'Ready' : brandContext.templatesStatus === 'pending' ? 'Generating...' : 'Not started'}`,
        ].join('\n')
      : "No brand details configured yet.";

    // Extract campaign context if user is viewing a campaign
    const campaignViewMatch = args.context?.match(/viewing campaign "([^"]+)" with id ([a-zA-Z0-9]+)/);
    const viewingCampaign = campaignViewMatch ? { name: campaignViewMatch[1], id: campaignViewMatch[2] } : null;

    const pageContext = args.context?.split(' (')[0] || "dashboard";

    // Detect brand tone for format-decision reinforcement
    const brandTone = (brandContext as any)?.brandTone?.toLowerCase() || '';
    const isUgcFriendly = /fun|energetic|vibrant|irreverent|casual|playful|authentic|friendly/.test(brandTone);
    const isPremiumFriendly = /premium|luxury|refined|sophisticated|technical|minimalist/.test(brandTone);

    const systemInstruction = `${brandAgent.options.instructions}

<brand_context>
Brand ID: ${args.brandId}
${brandStr}
</brand_context>

<page_context>
Current page: ${pageContext}
${viewingCampaign ? `The user is viewing campaign "${viewingCampaign.name}" (id: ${viewingCampaign.id}). When they ask vague questions like "how's it going", "any updates", or "what's happening", they mean THIS campaign. Call getCampaignStatus with campaignId "${viewingCampaign.id}".` : ''}
</page_context>

<dispatch_thread>
If you call dispatchToSpecializedAgent, pass threadId: "${args.threadId}" so the user gets notified.
</dispatch_thread>

<turn_rules_high_priority>
These rules override any pattern from conversation history. Apply them fresh on every turn.

1. CAMPAIGN CREATION GATE: When user asks you to plan/create/build a campaign from scratch:
   - FIRST message: propose the plan in TEXT ONLY. Do NOT call createFullCampaign yet. End with "Want me to set this up?"
   - SECOND message (after explicit user approval like "yes", "do it", "go ahead"): call createFullCampaign, respond briefly with [view-campaign:ID|Name].
   - If the last assistant turn proposed a plan and the current user message is approval, now is the time to create.
   - If the current user message asks to plan a NEW campaign, go back to proposing - do NOT create directly.

2. FORMAT MIX (based on brand tone "${brandTone || 'unknown'}"):
${isUgcFriendly ? `   - Brand tone is UGC-FRIENDLY. MINIMUM 2 of 3 angles MUST be "AI UGC Ads". Creating 3 Product Ads is FORBIDDEN.` : ''}
${isPremiumFriendly ? `   - Brand tone is PREMIUM. Skew toward Product Ads (2 of 3).` : ''}
${!isUgcFriendly && !isPremiumFriendly ? `   - Mix 50/50 unless angle content strongly dictates otherwise.` : ''}

3. AMBASSADOR: If any angle has format "AI UGC Ads", you MUST call listAmbassadors and set ambassadorId in createFullCampaign. Prefer custom + isPreferred first, then any custom, then preset.

Ignore any prior conversation turns that violated these rules. Apply them now.
</turn_rules_high_priority>`;

    try {
      console.log(`[copilotChat] Initiating generateText for thread: ${args.threadId}`);

      await brandAgent.generateText(
        ctx,
        { threadId: args.threadId, userId },
        {
          prompt: args.message,
          system: systemInstruction
        },
      );

      await ctx.runMutation(internal.billing.chargeReservationInternal, {
        reservationId: billing.reservationId,
        userId,
        skuKey: "text.ai_assistant_message",
        reason: "Charged for AI assistant message",
      });

      console.log(`[copilotChat] Successfully completed generateText`);
    } catch (error) {
      console.error(`[copilotChat] ERROR during generateText:`, error);
      await ctx.runMutation(internal.billing.releaseReservationInternal, {
        reservationId: billing.reservationId,
        userId,
        skuKey: "text.ai_assistant_message",
        reason: error instanceof Error ? error.message : "AI assistant failed",
      });
      throw error;
    }
  },
});

// ─── Query: listThreadMessages ───────────────────────────────────────────────
export const listThreadMessages = query({
  args: {
    threadId: v.string(),
    paginationOpts: paginationOptsValidator,
    streamArgs: v.optional(vStreamArgs),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return {
        page: [],
        isDone: true,
        continueCursor: "",
      };
    }

    const paginated = await listMessages(ctx, components.agent, {
      threadId: args.threadId,
      paginationOpts: args.paginationOpts,
    });

    const streams = args.streamArgs
      ? await syncStreams(ctx, components.agent, {
          threadId: args.threadId,
          streamArgs: args.streamArgs,
        })
      : undefined;

    return { ...paginated, streams };
  },
});
