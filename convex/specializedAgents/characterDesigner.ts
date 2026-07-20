/**
 * Character Designer - Specialized Agent (Pure Function)
 *
 * Zero Convex dependency. Zero side-effects beyond calling fal.ai.
 * Can be used directly by the Convex task runner, or extracted to any
 * external API gateway without modification.
 *
 * Powered by: gpt-image-1.5
 */

import * as fal from "@fal-ai/serverless-client";
import type { CharacterDesignerInput, CharacterDesignerOutput } from "./types";

const CHARACTER_MODEL = "fal-ai/gpt-image-1.5";

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

  const falInput = {
    prompt,
    image_size: "1024x1024",
    background: "auto",
    quality: "high",
    num_images: 1,
    output_format: "png",
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

  // § 0 - Role preamble
  // Frames the model's interpretation of everything that follows.
  // Image models don't have a system prompt field, but a strong opening
  // context achieves the same anchoring effect.
  parts.push(
    `[Role: You are a world-class commercial portrait photographer and brand identity designer. ` +
    `You specialize in creating brand ambassador portraits optimized for digital marketing, ` +
    `social media ads, and AI video generation. Every image you produce is campaign-ready.]`
  );

  // § 1 - Subject and role
  parts.push(
    `Create a brand ambassador portrait for "${input.brandName}". ` +
    `This person is the recognisable face of the brand across marketing campaigns, social media ads, and video content.`
  );

  // § 2 - Visual style
  const style = input.stylePreference || "Photorealistic";
  parts.push(`Visual style: ${style}.`);

  // § 3 - Appearance characteristics
  if (input.genderPresentation) {
    parts.push(`The person presents as ${input.genderPresentation.toLowerCase()}.`);
  }
  if (input.ageRange) {
    parts.push(`Apparent age: ${input.ageRange}.`);
  }
  if (input.appearanceDetails) {
    parts.push(input.appearanceDetails);
  }

  // § 4 - Brand tone → concrete visual direction
  // Map abstract tone descriptions to specific visual cues the model understands
  const tone = input.brandTone || "professional and approachable";
  const toneLower = tone.toLowerCase();
  const toneVisuals: string[] = [];

  if (toneLower.includes("bold") || toneLower.includes("direct") || toneLower.includes("confident")) {
    toneVisuals.push("strong confident posture", "direct eye contact with camera", "powerful studio lighting with contrast");
  } else if (toneLower.includes("warm") || toneLower.includes("friendly") || toneLower.includes("approachable")) {
    toneVisuals.push("genuine warm smile", "relaxed natural posture", "soft warm lighting");
  } else if (toneLower.includes("premium") || toneLower.includes("luxury") || toneLower.includes("refined")) {
    toneVisuals.push("elegant composed expression", "subtle confident smile", "dramatic cinematic lighting");
  } else if (toneLower.includes("playful") || toneLower.includes("fun") || toneLower.includes("energetic")) {
    toneVisuals.push("energetic engaging expression", "dynamic natural pose", "bright vibrant lighting");
  } else if (toneLower.includes("minimal") || toneLower.includes("clean") || toneLower.includes("calm")) {
    toneVisuals.push("serene composed expression", "still centered pose", "even diffused lighting");
  } else {
    toneVisuals.push("approachable confident expression", "natural relaxed pose", "professional studio lighting");
  }

  parts.push(`Mood and atmosphere: ${toneVisuals.join(", ")}. The visual energy should feel ${tone}.`);

  // § 5 - Clothing direction
  // Brand colours are a soft hint, not a requirement. Natural-looking outfit is priority.
  const primary = input.primaryColor || "#1a1a2e";
  parts.push(
    `Clothing should look natural and stylistically appropriate for the brand's tone and industry. ` +
    `If the outfit naturally lends itself to it, a hint of the brand colour ${primary}${input.secondaryColor ? ` or ${input.secondaryColor}` : ''} in the fabric or an accessory is a nice touch, but do not force it. ` +
    `A well-dressed person in neutral tones is better than an awkwardly colour-matched outfit. ` +
    `Do not add patterns, graphics, logos, prints, or text on clothing unless the appearance details above specifically request them.`
  );

  // § 6 - Brand context enrichment
  if (input.brandTagline) {
    parts.push(`The brand's tagline is "${input.brandTagline}".`);
  }
  if (input.brandGoal) {
    const goalHint: Record<string, string> = {
      campaign: "This person will appear in short-form video ads. They should feel authentic, camera-ready, and relatable.",
      calendar: "This person will be the face of social media content. They should feel approachable and engaging.",
      email: "This person will appear in email marketing. They should feel trustworthy and warm.",
      blog: "This person will be associated with editorial content. They should feel credible and thoughtful.",
    };
    const hint = goalHint[input.brandGoal];
    if (hint) parts.push(hint);
  }

  // § 7 - Composition and framing (critical for downstream video generation)
  parts.push(
    `Composition: head and shoulders portrait, centered in frame, facing directly toward camera. ` +
    `Background must be a plain solid neutral colour (white, light grey, or soft off-white). Do not use brand colours, gradients, patterns, or any elements in the background. ` +
    `The image must work as a profile photo, video thumbnail, and face reference for AI video generation.`
  );

  // § 8 - Technical quality and restrictions
  // Hard negatives: things that should never appear regardless of user input
  // Soft negatives: excluded by default but overridden if user's appearance details mention them
  const details = (input.appearanceDetails || "").toLowerCase();

  const hardNegatives = "watermarks, text overlays, logos, speech bubbles, multiple people, extreme angles, cropped features";

  const softNegatives: string[] = [];
  if (!details.includes("sunglass") && !details.includes("shades")) softNegatives.push("sunglasses");
  if (!details.includes("hat") && !details.includes("cap") && !details.includes("beanie") && !details.includes("headwear")) softNegatives.push("hats obscuring face");
  if (!details.includes("hand") && !details.includes("touching face") && !details.includes("chin rest")) softNegatives.push("hands touching face");
  if (!details.includes("mask") && !details.includes("face cover")) softNegatives.push("face coverings");

  parts.push(
    `Technical: commercial quality, ultra-high detail, sharp focus on face, ` +
    `${style.toLowerCase().includes("photorealistic") ? "natural skin texture and pores visible, realistic hair strands" : "crisp clean linework, consistent style throughout"}. ` +
    `Square 1:1 aspect ratio. ` +
    `Never include: ${hardNegatives}. ` +
    (softNegatives.length > 0
      ? `Avoid unless the appearance details above say otherwise: ${softNegatives.join(", ")}.`
      : "")
  );

  return parts.join(" ");
}


