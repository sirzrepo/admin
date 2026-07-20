import { internalMutation } from "../_generated/server";
import { v } from "convex/values";

const SEED_TEMPLATES = [
  {
    name: "Product Launch",
    description: "Announce your new product with excitement and clarity",
    category: "evergreen",
    industries: ["fashion", "beauty", "tech", "food", "fitness", "health", "lifestyle", "home"],
    suggestedTypes: ["Product Ads", "AI UGC Ads"],
    suggestedAngles: ["problem-result", "transformation", "social-proof"],
    sampleHooks: [
      "Finally, a product that actually works!",
      "You've been waiting for this...",
      "This changes everything!"
    ],
    source: "system",
  },
  {
    name: "Before & After",
    description: "Show dramatic transformations to prove product effectiveness",
    category: "evergreen",
    industries: ["beauty", "fitness", "health"],
    suggestedTypes: ["AI UGC Ads"],
    suggestedAngles: ["before-after", "transformation", "testimonial"],
    sampleHooks: [
      "Wait until you see the before & after...",
      "One month in and look at these results!",
      "From zero to hero in just weeks"
    ],
    source: "system",
  },
  {
    name: "Social Proof",
    description: "Build trust with customer testimonials and reviews",
    category: "evergreen",
    industries: ["fashion", "beauty", "tech", "food", "fitness", "health", "lifestyle", "home"],
    suggestedTypes: ["AI UGC Ads", "Product Ads"],
    suggestedAngles: ["social-proof", "testimonial", "customer-story"],
    sampleHooks: [
      "Don't just take our word for it...",
      "See what [X] customers are saying",
      "The reviews are in and they're incredible"
    ],
    source: "system",
  },
  {
    name: "How-To Tutorial",
    description: "Educate your audience while showcasing your product",
    category: "evergreen",
    industries: ["fashion", "beauty", "tech", "food", "fitness", "health", "lifestyle", "home"],
    suggestedTypes: ["Product Ads", "AI UGC Ads"],
    suggestedAngles: ["how-to", "educational", "demo"],
    sampleHooks: [
      "Here's exactly how to use it...",
      "Step by step, made simple",
      "The trick nobody tells you about"
    ],
    source: "system",
  },
  {
    name: "Seasonal Sale",
    description: "Create urgency with time-limited offers",
    category: "seasonal",
    industries: ["fashion", "beauty", "tech", "food", "fitness", "lifestyle", "home"],
    suggestedTypes: ["Product Ads"],
    suggestedAngles: ["urgency", "limited-time", "exclusive-deal"],
    sampleHooks: [
      "Only [X] hours left!",
      "Don't miss out on this deal",
      "Sale ends soon - don't wait!"
    ],
    source: "system",
  },
  {
    name: "New Arrival Showcase",
    description: "Highlight new inventory with excitement",
    category: "evergreen",
    industries: ["fashion", "tech", "home"],
    suggestedTypes: ["Product Ads"],
    suggestedAngles: ["new-arrival", "exclusivity", "behind-scenes"],
    sampleHooks: [
      "Just dropped - get them before they're gone!",
      "Brand new and already selling out",
      "Hot off the press - our latest drop"
    ],
    source: "system",
  },
  {
    name: "Behind The Scenes",
    description: "Give your audience a peek into your brand story",
    category: "evergreen",
    industries: ["fashion", "beauty", "tech", "food", "fitness", "lifestyle", "home"],
    suggestedTypes: ["AI UGC Ads"],
    suggestedAngles: ["behind-scenes", "brand-story", "authenticity"],
    sampleHooks: [
      "Ever wondered how we make this?",
      "A day in the life at our studio",
      "Here's what really goes on behind closed doors"
    ],
    source: "system",
  },
  {
    name: "Problem Solution",
    description: "Address pain points and offer your product as the solution",
    category: "evergreen",
    industries: ["fashion", "beauty", "tech", "food", "fitness", "health", "lifestyle", "home"],
    suggestedTypes: ["Product Ads", "AI UGC Ads"],
    suggestedAngles: ["problem-result", "pain-point", "solution"],
    sampleHooks: [
      "Tired of dealing with this?",
      "We finally solved [X] problem",
      "If you struggle with this, this is for you"
    ],
    source: "system",
  },
  {
    name: "Holiday Gift Guide",
    description: "Perfect for gifting season promotions",
    category: "seasonal",
    industries: ["fashion", "beauty", "tech", "food", "fitness", "lifestyle", "home"],
    suggestedTypes: ["Product Ads"],
    suggestedAngles: ["gift-guide", "holiday", "gift-ready"],
    sampleHooks: [
      "The gift they've been asking for",
      "Find the perfect gift this holiday",
      "Everyone on your list will love this"
    ],
    source: "system",
  },
  {
    name: "Ambassador Story",
    description: "Feature your brand ambassador or influencer",
    category: "evergreen",
    industries: ["fashion", "beauty", "fitness", "lifestyle"],
    suggestedTypes: ["AI UGC Ads"],
    suggestedAngles: ["ambassador", "influencer", "creator-collab"],
    sampleHooks: [
      "Meet the face of our brand",
      "Our ambassador shares their experience",
      "Why [creator] loves this product"
    ],
    source: "system",
  },
];

// Internal mutation - run from Convex dashboard:
//   data/seedTemplates:seedCampaignTemplates({})
export const seedCampaignTemplates = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const insertedIds: string[] = [];

    for (const template of SEED_TEMPLATES) {
      const templateId = await ctx.db.insert("campaignTemplates", {
        ...template,
        usageCount: 0,
        isActive: true,
        createdAt: now,
      });
      insertedIds.push(templateId);
    }

    return { success: true, count: insertedIds.length, ids: insertedIds };
  },
});