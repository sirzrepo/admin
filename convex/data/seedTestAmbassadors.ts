import { internalAction } from "../_generated/server";
import { api, internal } from "../_generated/api";
import { runCharacterDesigner } from "../specializedAgents/characterDesigner";

// ─── Seed Test Ambassadors ───────────────────────────────────────────────────
// Generates 3 preset ambassadors with real AI-generated images via fal.ai.
// Uses the character designer in polling mode (waits for result).
//
// Run: npx convex run data/seedTestAmbassadors:seedTestAmbassadors
//
// Requires FAL_API_KEY to be set in env vars.
// Takes ~30-60 seconds per ambassador (AI image generation).

const AMBASSADORS_TO_SEED = [
  {
    name: "Marcus",
    personality: "Bold & Direct",
    niche: "Tech & Gadgets",
    category: "tech",
    sampleHook: "Here's why everyone is switching to this",
    designInput: {
      brandName: "SIRz",
      brandTone: "Bold, confident, and direct",
      primaryColor: "#3d56f5",
      stylePreference: "Photorealistic",
      genderPresentation: "Masculine",
      ageRange: "Adult (26-40)",
      appearanceDetails: "Dark-skinned Black man, strong jawline, short fade haircut, wearing a clean modern tech-style jacket. Confident posture, looking straight at camera with a slight knowing smile. Studio lighting, dark minimal background.",
    },
  },
  {
    name: "James",
    personality: "Motivating & High-Energy",
    niche: "Fitness & Lifestyle",
    category: "fitness",
    sampleHook: "The results after 7 days shocked me",
    designInput: {
      brandName: "SIRz",
      brandTone: "Energetic, motivating, and authentic",
      primaryColor: "#3d56f5",
      stylePreference: "Photorealistic",
      genderPresentation: "Masculine",
      ageRange: "Young Adult (18-25)",
      appearanceDetails: "Athletic build, warm skin tone, short curly hair, wearing activewear. Energetic expression, natural smile. Bright natural lighting, clean background.",
    },
  },
  {
    name: "Zara",
    personality: "Relatable & Energetic",
    niche: "Beauty & Skincare",
    category: "beauty",
    sampleHook: "You need this in your life",
    designInput: {
      brandName: "SIRz",
      brandTone: "Warm, approachable, and relatable",
      primaryColor: "#3d56f5",
      stylePreference: "Photorealistic",
      genderPresentation: "Feminine",
      ageRange: "Young Adult (18-25)",
      appearanceDetails: "Glowing clear skin, long dark wavy hair, minimal natural makeup. Wearing a casual soft-toned top. Warm approachable expression, genuine smile. Soft studio lighting, light neutral background.",
    },
  },
];

export const seedTestAmbassadors = internalAction({
  args: {},
  handler: async (ctx) => {
    const falApiKey = process.env.FAL_API_KEY;
    if (!falApiKey) {
      console.error("[seedTestAmbassadors] FAL_API_KEY not set");
      return { error: "FAL_API_KEY not set" };
    }

    // Check which already exist
    const existing = await ctx.runQuery(api.ambassadors.listPresetAmbassadors, {});
    const existingNames = new Set(existing.map((a: any) => a.name));

    const results: Array<{ name: string; status: string }> = [];

    for (const ambassador of AMBASSADORS_TO_SEED) {
      if (existingNames.has(ambassador.name)) {
        console.log(`[seedTestAmbassadors] Skipping ${ambassador.name} - already exists`);
        results.push({ name: ambassador.name, status: "skipped" });
        continue;
      }

      console.log(`[seedTestAmbassadors] Generating ${ambassador.name}...`);

      try {
        // Run character designer in polling mode (synchronous, waits for fal.ai)
        const output = await runCharacterDesigner(
          ambassador.designInput as any,
          falApiKey,
          // No webhook URL = polling mode
        );

        if ("imageUrl" in output && output.imageUrl) {
          // Insert into ambassadors table
          await ctx.runMutation(internal.data.seedTestAmbassadors.insertAmbassador, {
            name: ambassador.name,
            imageUrl: output.imageUrl,
            personality: ambassador.personality,
            niche: ambassador.niche,
            category: ambassador.category,
            sampleHook: ambassador.sampleHook,
          });

          console.log(`[seedTestAmbassadors] ${ambassador.name} created with image: ${output.imageUrl}`);
          results.push({ name: ambassador.name, status: "created" });
        } else {
          console.error(`[seedTestAmbassadors] ${ambassador.name} generation returned no imageUrl`);
          results.push({ name: ambassador.name, status: "failed - no image" });
        }
      } catch (error) {
        console.error(`[seedTestAmbassadors] ${ambassador.name} failed:`, error);
        results.push({ name: ambassador.name, status: `failed - ${error instanceof Error ? error.message : "unknown"}` });
      }
    }

    return results;
  },
});

// Internal mutation to insert ambassador (actions can't write to DB directly)
import { internalMutation } from "../_generated/server";
import { v } from "convex/values";

export const insertAmbassador = internalMutation({
  args: {
    name: v.string(),
    imageUrl: v.string(),
    personality: v.string(),
    niche: v.string(),
    category: v.string(),
    sampleHook: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("ambassadors", {
      ...args,
      type: "preset",
      isActive: true,
      createdAt: Date.now(),
    });
  },
});
