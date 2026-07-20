/**
 * Script Generator - Specialized Agent (Pure Function)
 *
 * Expands shallow creative angles (name + hook + 2-sentence outline) into
 * detailed scene-by-scene video production briefs that produce better output
 * from AI video generators (Kling/fal.ai).
 *
 * Prompt structure derived from operator samples (Nana/Zara/Ayo):
 * - 3-5 scenes per video, each 3-5 seconds
 * - Camera angle, character action, exact dialogue, visual focus per scene
 * - UGC: handheld iPhone feel, eye-level, natural lighting, direct-to-camera
 * - Product Ads: cinematic close-ups, smooth camera, studio lighting
 * - Narrative arc: hook → demonstration → result/reveal
 */

import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateObject } from "ai";
import { z } from "zod";
import type { ScriptGeneratorInput, ScriptGeneratorOutput } from "./types";

const getModel = () => {
  const openrouter = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY! });
  return openrouter("openai/gpt-4o-mini");
};

// ─── Zod schema for structured AI output ─────────────────────────────────────

const sceneSchema = z.object({
  sceneNumber: z.number(),
  timeCode: z.string().describe("e.g. '0s-3s'"),
  camera: z.string().describe("Camera angle, movement, and framing - e.g. 'Close-up, eye-level, slight handheld movement'"),
  characterAction: z.string().describe("What the character/product physically does in this scene"),
  dialogue: z.string().describe("Exact words spoken (UGC) or voiceover text (Product Ad). Empty string if no dialogue."),
  visualFocus: z.string().describe("What the viewer's eye should be drawn to - textures, lighting, expressions, product details"),
});

const scriptSchema = z.object({
  scripts: z.array(z.object({
    angleId: z.string(),
    socialCaption: z.string().describe("The hook rephrased as an engaging social media caption with 3-5 hashtags"),
    suggestedDuration: z.enum(["5", "10", "15"]).describe("Total video duration in seconds based on scene count and dialogue length"),
    scenes: z.array(sceneSchema).min(2).max(5).describe("Scene-by-scene production brief. 3-5 scenes, each 3-5 seconds."),
  })),
});

// ─── System prompt (derived from operator patterns) ──────────────────────────

const SYSTEM_PROMPT = `You are a senior short-form video ad director who has produced thousands of high-performing TikTok and Instagram Reels ads. You create hyper-detailed scene-by-scene production briefs that AI video generators can execute precisely. Your briefs are so specific that anyone reading them can visualize the exact video.

PRODUCTION RULES:
- Each video has 3-5 scenes. Each scene is 3-5 seconds. Total MUST NOT exceed the specified max duration.
- IMPORTANT: The combined text of all scenes for one video must stay under 1800 characters total. Be vivid but concise - every word must earn its place.
- Every scene MUST specify ALL FOUR fields with rich detail:
  * camera: Exact angle, lens feel, movement direction, and framing (e.g. "Tight close-up at eye-level, slight handheld drift to the right, warm daylight from the left side, shallow depth of field")
  * characterAction: Precise physical movements including posture, gestures, facial expressions, interaction with objects (e.g. "Holds the product up at chin height with right hand, tilts it slowly toward camera, slight confident smirk, shoulders relaxed")
  * dialogue: Exact conversational words spoken - short, punchy, no marketing jargon. Empty string for product ads. For UGC, write how real people talk, not copywriters.
  * visualFocus: What the viewer's eye is drawn to - describe textures, materials, lighting quality, colors, reflections, skin tones, environmental details (e.g. "Golden hour light catching the metallic edge, warm skin tones, out-of-focus green foliage in background")
- Timecodes must be sequential and not exceed the total duration.
- NEVER include text overlays, subtitles, watermarks, logos, or on-screen graphics in any scene.
- NEVER include background music references.

UGC AD RULES (creator speaks to camera):
- Camera: Handheld iPhone feel. Eye-level. Slight natural shake. Natural daylight or warm indoor lighting. Close to medium framing on face and upper body.
- Setting: ALWAYS describe where the character is (e.g. "bright living room with plants visible behind", "outdoor patio with morning light"). Never leave the environment undefined.
- Character identity: If an ambassador name is provided, reference them by name. Describe their energy and demeanor in the first scene.
- Performance: Direct eye contact. Natural micro-expressions (slight nods, brow raises, genuine smiles). Organic hand gestures - not choreographed.
- Dialogue style: Short declarative sentences. Conversational contractions ("wanna", "gonna", "it's like"). Validate the viewer first ("I know you've tried everything..."). Personal framing ("I tested this for 3 weeks").
- Narrative: Hook (grab attention with a question or bold claim) → Personal experience/demonstration → Confident recommendation
- Tone: Authentic, relatable, warm - like a trusted friend sharing a discovery, NOT a salesperson

PRODUCT AD RULES (product is the hero, NO human presenter):
- Camera: Smooth cinematic orbiting, slow push-ins, dramatic reveals, crane-style movements. Studio-grade lighting with rim lights and soft fills.
- Setting: Clean environments that complement the product - studio backdrop, natural environment matching the product's use case, or contextual lifestyle setting.
- Surfaces and textures: ALWAYS describe the surface the product sits on and the quality of light hitting it (e.g. "Matte concrete surface, single warm key light from above creating a sharp shadow to the right").
- Product interaction: Show the product from multiple angles. Capture material textures, construction details, brand elements through camera movement - not text.
- Narrative: Dramatic reveal → Product in action/context → Hero beauty shot
- NEVER suggest text overlays, feature callouts, price displays, or any on-screen text.

SOCIAL CAPTION RULES:
- Rephrase the hook as a scroll-stopping social post - short, punchy, emoji-forward
- Keep it under 150 characters before hashtags
- Add 3-5 relevant hashtags (mix of broad reach + niche community)
- Match the brand's tone - casual brands get casual captions, premium brands get polished captions
- Do NOT include calls to action like "click below" or "link in bio" - those are added separately

DURATION GUIDELINES:
- 5s: Simple product reveal or single dramatic moment (2 scenes)
- 10s: Standard ad with hook + demo + result (3-4 scenes)
- 15s: Full story with multiple dialogue beats and visual variety (4-5 scenes)
- Choose based on how much the script genuinely needs to show. Do NOT pad scenes to fill time.`;

// ─── Assemble scenes into a continuous production brief for Kling ────────────

const KLING_PROMPT_LIMIT = 2500;

function assembleProductionBrief(
  scenes: Array<{ sceneNumber: number; timeCode: string; camera: string; characterAction: string; dialogue: string; visualFocus: string }>,
  format: "Product Ads" | "AI UGC Ads",
  totalDuration: string,
): string {
  const styleTag = format === "AI UGC Ads"
    ? "UGC vertical video, handheld iPhone feel, natural light, eye-level."
    : "Cinematic product showcase, vertical, smooth camera, studio lighting.";

  // For each scene, only include what's unique - skip repeated camera boilerplate
  const sceneDescriptions = scenes.map((scene, i) => {
    const parts: string[] = [`[${scene.timeCode}]`];

    // Only include camera direction if it differs from the style tag or previous scene
    const prevCamera = i > 0 ? scenes[i - 1].camera : "";
    if (scene.camera !== prevCamera) {
      // Strip common UGC boilerplate that's already in styleTag
      const shortCamera = scene.camera
        .replace(/handheld\s*(iPhone\s*)?(style)?[,.]?\s*/gi, '')
        .replace(/eye-level[,.]?\s*/gi, '')
        .replace(/slight\s*shaky?\s*cam[,.]?\s*/gi, '')
        .replace(/warm\s*indoor\s*lighting[,.]?\s*/gi, '')
        .replace(/natural\s*lighting?[,.]?\s*/gi, '')
        .trim();
      if (shortCamera) parts.push(shortCamera);
    }

    // Action - always unique per scene
    parts.push(scene.characterAction);

    // Dialogue - the most important part for UGC
    if (scene.dialogue) {
      parts.push(`"${scene.dialogue}"`);
    }

    // Visual focus - shortened, only key visual detail
    if (scene.visualFocus) {
      // Take just the first sentence of visual focus to save chars
      const shortVisual = scene.visualFocus.split(/[.,]/).slice(0, 2).join(',').trim();
      if (shortVisual) parts.push(shortVisual);
    }

    return parts.join(". ");
  });

  let brief = `${styleTag} ${totalDuration}s. ${sceneDescriptions.join(" ")}`;

  // Hard limit - leave room for videoGenerator additions (~200 chars for elements + quality)
  const maxLen = KLING_PROMPT_LIMIT - 200;
  if (brief.length > maxLen) {
    brief = brief.slice(0, maxLen - 3) + "...";
  }

  return brief;
}

// ─── Main runner ─────────────────────────────────────────────────────────────

export async function runScriptGenerator(
  input: ScriptGeneratorInput,
): Promise<ScriptGeneratorOutput> {
  const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
  if (!OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY not configured");
  }

  const model = getModel();

  const anglesDescription = input.angles.map((angle, i) => {
    const formatLabel = angle.format === "AI UGC Ads" ? "UGC Ad (creator to camera)" : "Product Ad (product hero)";
    return `Angle ${i + 1} (${formatLabel}):
  - ID: ${angle.id}
  - Name: ${angle.name}
  - Hook: "${angle.hook}"
  - Concept: ${angle.scriptOutline}`;
  }).join("\n\n");

  const contextParts: string[] = [];
  contextParts.push(`Brand: ${input.brandName}`);
  if (input.brandTone) contextParts.push(`Brand voice/tone: ${input.brandTone}`);
  if (input.industry) contextParts.push(`Industry: ${input.industry}`);
  contextParts.push(`Product: ${input.productName}`);
  if (input.productCategory) contextParts.push(`Product category: ${input.productCategory}`);
  if (input.targetAudience) contextParts.push(`Target audience: ${input.targetAudience}`);
  if (input.campaignGoal) {
    // Goal shapes both scene direction (urgency vs storytelling) and
    // the social caption (CTA vs broader hook). Stated explicitly so
    // the model can't ignore it as flavor text.
    const goalDirection =
      input.campaignGoal === "conversion"
        ? "drive a clear purchase action - urgency, value-prop forward, end with a concrete CTA in the caption"
        : input.campaignGoal === "retention"
        ? "speak to existing customers - insider tone, loyalty/upgrade beats, reward language over discovery language"
        : "build broad brand awareness - emotional, scroll-stopping storytelling first, no hard sell";
    contextParts.push(`Campaign goal: ${input.campaignGoal} (${goalDirection})`);
  }
  if (input.ambassadorName) {
    const personalityDesc = input.ambassadorPersonality || 'confident and relatable';
    const nicheDesc = input.ambassadorNiche ? ` specializing in ${input.ambassadorNiche}` : '';
    contextParts.push(`AI presenter/ambassador: ${input.ambassadorName} - personality is ${personalityDesc}${nicheDesc}. This defines how they speak, their energy, and their delivery style in UGC angles.`);
  }
  contextParts.push(`Maximum video duration: ${input.maxDuration} seconds`);

  const result = await generateObject({
    model,
    schema: scriptSchema,
    system: SYSTEM_PROMPT,
    prompt: `Create hyper-detailed scene-by-scene production briefs for the following ${input.angles.length} video ad angles.

CONTEXT:
${contextParts.join("\n")}

ANGLES:
${anglesDescription}

REQUIREMENTS:
For each angle, generate:
1. A social caption - scroll-stopping, emoji-forward, with hashtags
2. A suggested duration (5, 10, or 15 seconds - fit the content, don't pad)
3. A scene-by-scene breakdown where EVERY field is richly detailed:
   - camera: specific angle + lens feel + movement + lighting direction + depth of field
   - characterAction: exact physical movements, posture, gestures, facial micro-expressions, object interaction
   - dialogue: conversational words (UGC only) - how real people talk, not copywriters. Use contractions, pauses, emphasis.
   - visualFocus: textures, materials, lighting quality, color temperature, reflections, environmental details

CRITICAL:
- UGC angles: describe the setting/environment in scene 1's visualFocus (where is the person filming?). Write dialogue like a real person talks - not polished marketing copy.
- Product angles: describe surfaces, materials, and lighting with sensory precision. ZERO text overlays or feature callout graphics.
- Every visual description should be so specific that closing your eyes you can picture the exact frame.`,
  });

  // Post-process deterministically by INPUT angles, not by model order.
  // The model occasionally omits an angle or mutates the angleId. Campaign
  // generation relies on the original ids for attached assets, media retries,
  // and captions, so every input angle must produce exactly one script row.
  const byId = new Map(result.object.scripts.map((script) => [script.angleId, script]));
  const scripts = input.angles.map((angle) => {
    const script = byId.get(angle.id) ?? result.object.scripts.find((candidate) =>
      candidate.angleId === angle.id ||
      candidate.angleId.toLowerCase() === angle.id.toLowerCase() ||
      candidate.angleId === angle.name,
    );
    const format = angle.format || "Product Ads";
    const fallbackDuration = input.maxDuration <= 5 ? "5" : input.maxDuration <= 10 ? "10" : "15";
    const fallbackScenes = [
      {
        sceneNumber: 1,
        timeCode: "0s-3s",
        camera: format === "AI UGC Ads" ? "Handheld eye-level close-up" : "Smooth close-up push-in",
        characterAction: angle.hook,
        dialogue: format === "AI UGC Ads" ? angle.hook : "",
        visualFocus: input.productName ? `Focus on ${input.productName}` : angle.name,
      },
      {
        sceneNumber: 2,
        timeCode: "3s-5s",
        camera: format === "AI UGC Ads" ? "Natural handheld medium shot" : "Cinematic product hero angle",
        characterAction: angle.scriptOutline || angle.hook,
        dialogue: "",
        visualFocus: input.productName ? `${input.productName} in use` : angle.name,
      },
    ];
    const scenes = script?.scenes?.length ? script.scenes : fallbackScenes;
    const suggestedDuration = script?.suggestedDuration ?? fallbackDuration;

    return {
      angleId: angle.id,
      socialCaption: script?.socialCaption || fallbackCaption(angle, input.productName),
      suggestedDuration,
      scenes,
      productionBrief: assembleProductionBrief(scenes, format, suggestedDuration),
    };
  });

  return { scripts };
}

function fallbackCaption(angle: ScriptGeneratorInput["angles"][number], productName: string): string {
  const base = angle.hook || angle.name || productName || "New campaign";
  const productTag = productName
    ? productName.replace(/[^a-zA-Z0-9]+/g, "").slice(0, 24)
    : "Product";
  return `${base} ✨ #${productTag || "Product"} #TikTokMadeMeBuyIt #ShopSmall`;
}
