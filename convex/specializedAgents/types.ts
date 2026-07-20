/**
 * Specialized Agent Type Contracts
 *
 * This file is intentionally PURE TypeScript - no Convex imports, no fal.ai imports.
 * It can be safely extracted and used by any external API gateway or cloud function.
 *
 * Each agent has a typed Input and Output. The Brand Agent uses these types when
 * gathering information from the user before dispatching a task.
 */

// ─── Character Designer ───────────────────────────────────────────────────────

export type CharacterDesignerInput = {
  // ── From brand DB (auto-populated with fallbacks) ──
  brandName: string;             // always required - fallback: ask user
  brandTone: string;             // optional in DB → fallback: "professional and approachable"
  primaryColor: string;          // optional in DB → fallback: "#1a1a2e"
  secondaryColor?: string;       // optional - included in prompt only if present
  brandTagline?: string;         // optional - enriches prompt if present
  brandGoal?: string;            // optional - shapes character archetype if present

  // ── Must be gathered from user ──
  stylePreference: string;       // e.g. "3D render", "illustrated flat", "photorealistic"
  genderPresentation?: string;   // optional: "feminine", "masculine", "neutral", "non-human"
  ageRange?: string;             // optional: "young adult", "mature", "ageless"
  appearanceDetails?: string;    // optional: specific hair, skin, clothing, glasses, etc
  referenceImageUrl?: string;    // optional: user-uploaded reference image URL
};

export type CharacterDesignerOutput = {
  imageUrl: string;
  prompt: string;      // the exact prompt sent to fal.ai, stored for re-use and transparency
  model: string;       // the fal.ai model used
  generatedAt: number; // timestamp
};

// ─── Image Generator ──────────────────────────────────────────────────────────

export type AssetReference = {
  type: "character" | "product";
  id: string;              // product ID or "brand-character"
  name: string;            // display name used in chip and prompt enrichment
  imageUrl?: string;       // the image URL passed to fal.ai image_urls[]
  description?: string;    // optional - further enriches the prompt
};

export type ImageGeneratorInput = {
  prompt: string;
  brandName: string;
  primaryColor?: string;
  brandTone?: string;
  style?: string;         // "Product Shot" | "Lifestyle" | "UGC" | "Cinematic"
  aspectRatio?: "1:1" | "16:9" | "21:9" | "9:16" | "4:5" | "4:3" | "3:2";
  resolution?: "1K" | "2K" | "4K";
  quality?: "low" | "medium" | "high";
  // Resolved @-mention references - if any image URLs exist, switches to image-to-image
  assetReferences?: AssetReference[];
  // Saved by task runner before webhook dispatch (same pattern as character_designer)
  builtPrompt?: string;
  resolvedModel?: string;
  resolvedImageUrls?: string[];
};

export type ImageGeneratorOutput = {
  imageUrl: string;
  prompt: string;
  model: string;
  generatedAt: number;
};

// ─── Video Generator ──────────────────────────────────────────────────────────

export type VideoStyle = "UGC Ad" | "Product Showcase" | "Brand Story" | "Cinematic";
export type VideoDuration = "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "11" | "12" | "13" | "14" | "15";
export type VideoAspectRatio = "16:9" | "9:16" | "1:1";

export type VideoGeneratorInput = {
  prompt: string;                      // unified creative direction (actions + dialogue)
  tokenizedPrompt?: string;            // prompt with deterministic asset tokens like [[asset:<id>]]
  brandName: string;
  primaryColor?: string;
  brandTone?: string;
  videoStyle?: VideoStyle;             // determines enforcement and style directive
  duration?: VideoDuration;            // defaults to "5"
  aspectRatio?: VideoAspectRatio;      // defaults to "16:9"
  generateAudio?: boolean;             // defaults to true
  assetReferences?: AssetReference[];  // from @-mentions + manual section picks
  // Saved by task runner before webhook dispatch
  builtPrompt?: string;
  resolvedModel?: string;
  resolvedStartImageUrl?: string;
  resolvedElements?: Array<{
    frontal_image_url?: string;
    reference_image_urls?: string[];
    video_url?: string;
  }>;
};

export type VideoGeneratorOutput = {
  videoUrl: string;
  thumbnailUrl?: string;
  prompt: string;
  model: string;
  generatedAt: number;
};

// ─── Script Generator ─────────────────────────────────────────────────────────

export type ScriptGeneratorInput = {
  angles: Array<{
    id: string;
    name: string;
    hook: string;
    scriptOutline: string;
    format: "Product Ads" | "AI UGC Ads";
  }>;
  productName: string;
  productCategory?: string;
  targetAudience?: string;
  brandName: string;
  brandTone?: string;
  industry?: string;
  ambassadorName?: string;
  ambassadorPersonality?: string; // e.g. "Relatable & Energetic", "Warm & Trustworthy"
  ambassadorNiche?: string;       // e.g. "Beauty & Skincare", "Outdoor Sports"
  // High-level campaign objective the user picked in the wizard. Shapes
  // scene direction + caption tone:
  //   awareness  -> brand-first storytelling, broad emotional appeal
  //   conversion -> urgency, value-prop forward, clear CTA
  //   retention  -> insider tone, loyalty / upgrade beats
  campaignGoal?: "awareness" | "conversion" | "retention";
  maxDuration: number; // 15
};

export type ScriptScene = {
  sceneNumber: number;
  timeCode: string;
  camera: string;
  characterAction: string;
  dialogue: string;
  visualFocus: string;
};

export type ScriptGeneratorOutput = {
  scripts: Array<{
    angleId: string;
    socialCaption: string;
    suggestedDuration: "5" | "10" | "15";
    scenes: ScriptScene[];
    productionBrief: string; // assembled continuous prompt for Kling
  }>;
};

// ─── Agent Registry ───────────────────────────────────────────────────────────
// Single source of truth for which agents exist and their availability status.
// This is checked by the Brand Agent before dispatching any task.

export const AGENT_REGISTRY = {
  character_designer: {
    available: true,
    label: "Ambassador Designer",
    description: "Generates brand ambassadors, personas, and visual spokespersons",
  },
  image_generator: {
    available: true,
    label: "Image Generator",
    description: "Generates product shots, lifestyle images, and marketing visuals with brand asset references",
  },
  video_generator: {
    available: true,
    label: "Video Generator",
    description: "Generates short-form videos with native audio, smart element referencing, and style control",
  },
  script_generator: {
    available: true,
    label: "Script Generator",
    description: "Expands creative angles into detailed scene-by-scene video production briefs",
  },
  brand_guide_analyzer: {
    available: true,
    label: "Brand Guide Analyzer",
    description: "Reads an uploaded brand guide and extracts structured brand info",
  },
} as const;

export type AgentType = keyof typeof AGENT_REGISTRY;
