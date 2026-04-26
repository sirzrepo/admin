/**
 * Character Designer — Specialized Agent (Pure Function)
 *
 * Zero Convex dependency. Zero side-effects beyond calling fal.ai.
 * Can be used directly by the Convex task runner, or extracted to any
 * external API gateway without modification.
 *
 * Powered by: fal-ai/flux-pro/v1.1
 */

import * as fal from "@fal-ai/serverless-client";
import type { CharacterDesignerInput, CharacterDesignerOutput } from "./types";

const CHARACTER_MODEL = "fal-ai/flux-pro/v1.1";

/**
 * Webhook mode: submits job to fal.ai queue and returns immediately with requestId.
 * fal.ai will POST the result to the provided webhookUrl when done.
 *
 * Polling mode: waits for fal.ai to complete and returns the output directly.
 * Used as a fallback or when called from external callers that want synchronous results.
 */
export async function runCharacterDesigner(
  input: CharacterDesignerInput & { builtPrompt?: string },
  falApiKey: string,
  webhookUrl?: string,
): Promise<{ requestId: string } | CharacterDesignerOutput> {
  fal.config({ credentials: falApiKey });

  const prompt = input.builtPrompt || buildCharacterPrompt(input);
  const negativePrompt = buildNegativePrompt();

  const falInput = {
    prompt,
    negative_prompt: negativePrompt,
    image_size: "square_hd",
    num_inference_steps: 35,
    guidance_scale: 3.5,
    num_images: 1,
    enable_safety_checker: true,
  };

  // ── Webhook mode (primary): submit to fal.ai queue, returns requestId immediately ──
  if (webhookUrl) {
    const result = await fal.queue.submit(CHARACTER_MODEL, {
      input: falInput,
      webhookUrl: webhookUrl,
    });
    return { requestId: result.request_id };
  }

  // ── Polling mode (fallback): blocks until fal.ai returns ──
  const result = await fal.subscribe(CHARACTER_MODEL, { input: falInput }) as any;
  return {
    imageUrl: result.images[0].url,
    prompt,
    model: CHARACTER_MODEL,
    generatedAt: Date.now(),
  };
}

// ─── Prompt Builder (exported for task manager to store built prompt) ─────────

export function buildCharacterPrompt(input: CharacterDesignerInput): string {
  const parts: string[] = [];

  // § 1 — Subject definition
  parts.push(`A professional brand character / mascot for the brand "${input.brandName}".`);

  // § 2 — Role and narrative purpose
  parts.push(
    `This character serves as the brand's ${input.characterRole}, ` +
    `acting as a recognisable face across the brand's marketing, social media, and product presence.`
  );

  // § 3 — Personality expression
  parts.push(
    `Personality traits: ${input.characterPersonality}. ` +
    `The character's facial expression, posture, and energy should clearly and immediately ` +
    `communicate these traits to a viewer seeing the character for the first time.`
  );

  // § 4 — Brand tone alignment
  const tone = input.brandTone || "professional and approachable";
  parts.push(
    `The overall mood and atmosphere of the image should align with a "${tone}" brand tone. ` +
    `Every visual decision — lighting, colour warmth, composition — should reinforce this tone.`
  );

  // § 5 — Visual appearance characteristics
  if (input.genderPresentation) {
    parts.push(`Gender presentation: ${input.genderPresentation}.`);
  }
  if (input.ageRange) {
    parts.push(`Apparent age range: ${input.ageRange}.`);
  }

  // § 6 — Art direction and style
  parts.push(
    `Visual style: ${input.stylePreference}. ` +
    `The character must have a strong, iconic silhouette that remains recognisable at small sizes ` +
    `(e.g., app icon, profile photo, sticker). Avoid overly busy or complex designs.`
  );

  // § 7 — Brand colour integration
  const primary = input.primaryColor || "#1a1a2e";
  if (input.secondaryColor) {
    parts.push(
      `Colour palette: primary brand colour ${primary} and secondary colour ${input.secondaryColor}. ` +
      `These colours should be prominent and intentional in the character's design ` +
      `(clothing, accessories, skin tones, hair, or stylistic elements).`
    );
  } else {
    parts.push(
      `Colour palette: anchored by the brand's primary colour ${primary}. ` +
      `This colour should be prominent and intentional in the character's design.`
    );
  }

  // § 8 — Brand tagline (optional enrichment for tone inference)
  if (input.brandTagline) {
    parts.push(
      `Brand tagline for tonal reference: "${input.brandTagline}". ` +
      `Let this guide the subtle emotional mood of the character.`
    );
  }

  // § 9 — Brand goal archetype (optional — shapes character's energy)
  if (input.brandGoal) {
    const goalHint: Record<string, string> = {
      ugc: "The character should feel authentic, relatable, and content-creator adjacent — real and engaging.",
      calendar: "The character should feel organised, inspiring, and productive.",
      email: "The character should feel trustworthy, warm, and approachable — like a knowledgeable friend.",
      blog: "The character should feel thoughtful, credible, and articulate.",
    };
    const hint = goalHint[input.brandGoal];
    if (hint) parts.push(hint);
  }

  // § 10 — Technical production quality
  parts.push(
    `Technical requirements: commercial quality character design, ` +
    `clean or minimally styled background suitable for brand identity use across digital and print, ` +
    `centered composition, professional studio lighting, ` +
    `crisp linework if illustrated or flat style, photorealistic skin texture if realistic style, ` +
    `ultra-high detail, no watermarks, no text overlays, no speech bubbles, ` +
    `no multiple characters in frame. Single character, centred, full visibility.`
  );

  return parts.join(" ");
}

// ─── Negative Prompt ─────────────────────────────────────────────────────────

function buildNegativePrompt(): string {
  return [
    "blurry", "low quality", "low resolution", "pixelated",
    "distorted proportions", "extra limbs", "missing limbs", "bad anatomy",
    "watermark", "text overlay", "caption", "logo overlay", "speech bubble",
    "clutter", "busy cluttered background", "multiple characters in frame",
    "crowd", "group",
    "ugly", "deformed", "mutated", "artifact", "jpeg artifact",
    "poorly drawn", "amateur", "sketch", "unfinished",
    "oversaturated", "washed out",
  ].join(", ");
}
