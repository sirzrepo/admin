import { v } from "convex/values";
import { internalMutation } from "../_generated/server";

// ─── Preset Ambassador Data ───────────────────────────────────────────────────
// These 8 preset ambassadors are available to all brands. Images are hosted
// on the project's public CDN. Once the Character Designer agent generates
// better images, update the imageUrl values via updateAmbassador.

const PRESET_AMBASSADORS = [
  {
    name: "Zara",
    imageUrl: "https://api.dicebear.com/9.x/personas/svg?seed=Zara&backgroundColor=b6e3f4",
    personality: "Relatable & Energetic",
    niche: "Beauty & Skincare",
    category: "beauty",
    sampleHook: "You need this in your life",
  },
  {
    name: "Maya",
    imageUrl: "https://api.dicebear.com/9.x/personas/svg?seed=Maya&backgroundColor=c0aede",
    personality: "Warm & Trustworthy",
    niche: "Lifestyle & Wellness",
    category: "lifestyle",
    sampleHook: "I wasn't expecting this to work... but it did",
  },
  {
    name: "Sophia",
    imageUrl: "https://api.dicebear.com/9.x/personas/svg?seed=Sophia&backgroundColor=ffdfbf",
    personality: "Sophisticated & Expert",
    niche: "Fashion & Style",
    category: "fashion",
    sampleHook: "This changed my entire routine",
  },
  {
    name: "Ethan",
    imageUrl: "https://api.dicebear.com/9.x/personas/svg?seed=Ethan&backgroundColor=d1f4d1",
    personality: "Professional & Analytical",
    niche: "Tech & Gadgets",
    category: "tech",
    sampleHook: "Here's why everyone is switching to this",
  },
  {
    name: "Amara",
    imageUrl: "https://api.dicebear.com/9.x/personas/svg?seed=Amara&backgroundColor=ffd6e0",
    personality: "Vibrant & Authentic",
    niche: "Food & Cooking",
    category: "food",
    sampleHook: "Stop what you're doing and watch this",
  },
  {
    name: "Kai",
    imageUrl: "https://api.dicebear.com/9.x/personas/svg?seed=Kai&backgroundColor=c9f0d8",
    personality: "Motivating & High-Energy",
    niche: "Fitness & Health",
    category: "fitness",
    sampleHook: "The results after 7 days shocked me",
  },
  {
    name: "Luna",
    imageUrl: "https://api.dicebear.com/9.x/personas/svg?seed=Luna&backgroundColor=e8e8e8",
    personality: "Minimal & Modern",
    niche: "Home & Decor",
    category: "lifestyle",
    sampleHook: "This is the only product you need",
  },
  {
    name: "James",
    imageUrl: "https://api.dicebear.com/9.x/personas/svg?seed=James&backgroundColor=b8d4f0",
    personality: "Bold & Direct",
    niche: "Sports & Outdoor",
    category: "fitness",
    sampleHook: "Game-changing. Here's the proof",
  },
];

// ─── seedPresetAmbassadors ────────────────────────────────────────────────────
// Internal mutation. Inserts all 8 preset ambassadors if they don't already
// exist (checks by name to prevent duplicates on re-run).
// Run once after initial deploy via Convex dashboard:
//   data/seedAmbassadors:seedPresetAmbassadors({})
// internalMutation means it cannot be called from the client - only from the
// dashboard or other server-side code. This is the right shape for one-time
// platform setup (no user context required).

export const seedPresetAmbassadors = internalMutation({
  args: {},
  handler: async (ctx) => {
    // Fetch existing preset ambassadors to avoid duplicates
    const existing = await ctx.db
      .query("ambassadors")
      .withIndex("by_type", (q) => q.eq("type", "preset"))
      .collect();
    const existingNames = new Set(existing.map((a) => a.name));

    const now = Date.now();
    let inserted = 0;

    for (const ambassador of PRESET_AMBASSADORS) {
      if (existingNames.has(ambassador.name)) continue;

      await ctx.db.insert("ambassadors", {
        name: ambassador.name,
        imageUrl: ambassador.imageUrl,
        personality: ambassador.personality,
        niche: ambassador.niche,
        category: ambassador.category,
        sampleHook: ambassador.sampleHook,
        type: "preset",
        isActive: true,
        createdAt: now,
      });
      inserted++;
    }

    return { inserted, skipped: PRESET_AMBASSADORS.length - inserted };
  },
});
