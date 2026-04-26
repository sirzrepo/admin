/**
 * Specialized Agent Type Contracts
 *
 * This file is intentionally PURE TypeScript — no Convex imports, no fal.ai imports.
 * It can be safely extracted and used by any external API gateway or cloud function.
 *
 * Each agent has a typed Input and Output. The Brand Agent uses these types when
 * gathering information from the user before dispatching a task.
 */

// ─── Character Designer ───────────────────────────────────────────────────────

export type CharacterDesignerInput = {
  // ── From brand DB (auto-populated with fallbacks) ──
  brandName: string;             // always required — fallback: ask user
  brandTone: string;             // optional in DB → fallback: "professional and approachable"
  primaryColor: string;          // optional in DB → fallback: "#1a1a2e"
  secondaryColor?: string;       // optional — included in prompt only if present
  brandTagline?: string;         // optional — enriches prompt if present
  brandGoal?: string;            // optional — shapes character archetype if present

  // ── Must be gathered from user ──
  characterPersonality: string;  // e.g. "confident, witty, warm"
  characterRole: string;         // e.g. "brand mascot", "spokesperson", "avatar"
  stylePreference: string;       // e.g. "3D render", "illustrated flat", "photorealistic"
  genderPresentation?: string;   // optional: "feminine", "masculine", "neutral", "non-human"
  ageRange?: string;             // optional: "young adult", "mature", "ageless"
  referenceImageUrl?: string;    // optional: user-uploaded reference image URL
};

export type CharacterDesignerOutput = {
  imageUrl: string;
  prompt: string;      // the exact prompt sent to fal.ai, stored for re-use and transparency
  model: string;       // the fal.ai model used
  generatedAt: number; // timestamp
};

// ─── Image Generator ──────────────────────────────────────────────────────────

export type ImageGeneratorInput = {
  prompt: string;
  brandName: string;
  primaryColor?: string;
  style?: string;       // e.g. "product shot", "lifestyle", "UGC"
  aspectRatio?: "1:1" | "16:9" | "9:16" | "4:5";
};

export type ImageGeneratorOutput = {
  imageUrl: string;
  prompt: string;
  model: string;
  generatedAt: number;
};

// ─── Video Generator ──────────────────────────────────────────────────────────

export type VideoGeneratorInput = {
  script: string;
  brandName: string;
  style?: string;
  durationSeconds?: number;
};

export type VideoGeneratorOutput = {
  videoUrl: string;
  thumbnailUrl?: string;
  model: string;
  generatedAt: number;
};

// ─── UGC Video Generator ─────────────────────────────────────────────────────

export type UgcVideoInput = {
  script: string;
  brandName: string;
  productName?: string;
  style?: string;
};

export type UgcVideoOutput = {
  videoUrl: string;
  thumbnailUrl?: string;
  model: string;
  generatedAt: number;
};

// ─── Agent Registry ───────────────────────────────────────────────────────────
// Single source of truth for which agents exist and their availability status.
// This is checked by the Brand Agent before dispatching any task.

export const AGENT_REGISTRY = {
  character_designer: {
    available: true,
    label: "Character Designer",
    description: "Generates brand mascots, characters, and visual personas",
  },
  image_generator: {
    available: false,
    label: "Image Generator",
    description: "Generates product shots, lifestyle images, and marketing visuals",
    comingSoon: true,
  },
  video_generator: {
    available: false,
    label: "Video Generator",
    description: "Generates short-form video from scripts or images",
    comingSoon: true,
  },
  ugc_video: {
    available: false,
    label: "UGC Video Generator",
    description: "Generates UGC-style ad videos for social media",
    comingSoon: true,
  },
} as const;

export type AgentType = keyof typeof AGENT_REGISTRY;
