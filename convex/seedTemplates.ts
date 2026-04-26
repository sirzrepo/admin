import { v } from "convex/values";
import { mutation } from "./_generated/server";

// Seed campaign templates with sample data
export const seedCampaignTemplates = mutation({
  args: {},
  handler: async (ctx) => {
    const templates = [
      {
        name: "Easter Campaign",
        category: "seasonal",
        description: "Capitalize on the Easter moment with a timely campaign that resonates with your audience.",
        industries: ["home"],
        sampleHooks: [
          "Easter is almost here — are you ready?",
          "The perfect Easter gift for anyone who loves [product]",
          "Don't miss our Easter special",
        ],
        suggestedAngles: [
          "seasonal",
          "limited-time",
          "gift-guide",
        ],
        suggestedTypes: ["Product Ads", "AI UGC Ads"],
        seasonalTrigger: {
          activeFrom: 1773532800000,
          activeTo: 1775952000000,
          name: "Easter",
          type: "holiday",
        },
        source: "ai_generated",
        isActive: true,
        usageCount: 0,
        createdAt: Date.now(),
      },
      {
        name: "Summer Sale",
        category: "seasonal",
        description: "Boost your summer sales with this vibrant campaign template perfect for seasonal promotions.",
        industries: ["fashion", "beauty", "home"],
        sampleHooks: [
          "Summer vibes calling! ☀️",
          "Hot deals for cool summer days",
          "Your summer essentials are here",
        ],
        suggestedAngles: [
          "seasonal",
          "limited-time",
          "lifestyle",
        ],
        suggestedTypes: ["Product Ads", "Social Media Posts", "Email Campaign"],
        source: "ai_generated",
        isActive: true,
        usageCount: 0,
        createdAt: Date.now(),
      },
      {
        name: "Product Launch",
        category: "product",
        description: "Generate buzz and drive sales for your new product launch with this comprehensive campaign template.",
        industries: ["tech", "beauty", "fashion", "home"],
        sampleHooks: [
          "Introducing the game-changer you've been waiting for",
          "New product alert! 🚀",
          "The future of [category] is here",
        ],
        suggestedAngles: [
          "innovation",
          "exclusive",
          "problem-solution",
        ],
        suggestedTypes: ["Product Ads", "Launch Announcement", "Influencer Content"],
        source: "ai_generated",
        isActive: true,
        usageCount: 0,
        createdAt: Date.now(),
      },
    ];

    // Insert templates
    for (const template of templates) {
      await ctx.db.insert("campaignTemplates", template);
    }

    return { success: true, count: templates.length };
  },
});
