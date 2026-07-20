/**
 * Video Generator - Specialized Agent (Pure Function)
 *
 * Smart model switching:
 *  - No asset references  → fal-ai/kling-video/v3/standard/text-to-video
 *  - Asset references present → fal-ai/kling-video/v3/standard/image-to-video
 *
 * Element mapping:
 *  - character → @Element1 (also used as start_image_url)
 *  - product   → @Element2
 *  - Names found in prompt text are replaced with @ElementN
 *  - Names NOT found in text get an appended context line
 */

import * as fal from "@fal-ai/serverless-client";
import type { VideoGeneratorInput, VideoGeneratorOutput, AssetReference } from "./types";

const TEXT_TO_VIDEO_MODEL = "fal-ai/kling-video/v3/standard/text-to-video";
const IMAGE_TO_VIDEO_MODEL = "fal-ai/kling-video/v3/standard/image-to-video";
const KLING_PROMPT_MAX_BYTES = 2400;

type KlingElementInput = {
  frontal_image_url?: string;
  reference_image_urls?: string[];
  video_url?: string;
};

function hasValue<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

// ─── Style Directives ─────────────────────────────────────────────────────────

const VIDEO_STYLE_MAP: Record<string, string> = {
  "UGC Ad": "Handheld UGC style. Natural lighting. Eye-level framing. The character speaks directly to camera with authentic energy.",
  "Product Showcase": "Smooth cinematic camera orbit around the product. Studio-quality lighting. The product is the hero, no human presenter.",
  "Brand Story": "Warm aspirational storytelling. Confident character addressing the audience. Smooth camera movement. Emotionally engaging.",
  "Cinematic": "Cinematic wide-angle shot, dramatic lighting, film-grade color grading, dramatic depth of field.",
};

// ─── Prompt Builder ───────────────────────────────────────────────────────────

export function buildVideoPrompt(input: VideoGeneratorInput): {
  model: string;
  prompt: string;
  startImageUrl: string | null;
  elements: KlingElementInput[];
} {
  const refs = input.assetReferences ?? [];
  const character = refs.find(r => r.type === "character");
  const products = refs.filter(r => r.type === "product");

  const hasRefs = character || products.length > 0;

  // Assign element slots: character → Element1, first product → Element2
  const elementSlots: Array<{ ref: AssetReference; slot: number }> = [];
  if (character) elementSlots.push({ ref: character, slot: 1 });
  products.slice(0, character ? 1 : 2).forEach((p, i) =>
    elementSlots.push({ ref: p, slot: character ? 2 : i + 1 })
  );

  // ── Build prompt ──
  // Prefer deterministic tokenized prompt from editor when available.
  let prompt = (input.tokenizedPrompt || input.prompt || "").trim();

  // Style directive - only add for short/generic prompts (not detailed production briefs)
  const isDetailedBrief = prompt.length > 300;
  if (!isDetailedBrief) {
    if (input.videoStyle && VIDEO_STYLE_MAP[input.videoStyle]) {
      prompt += ` ${VIDEO_STYLE_MAP[input.videoStyle]}`;
    } else {
      prompt += ` Clean white or neutral background, natural even lighting.`;
    }
  }

  // Element substitution:
  // 1) deterministic token replacement: [[asset:<id>]] -> @ElementN
  // 2) fallback name replacement for legacy prompts
  // 3) append context if still not referenced
  for (const { ref, slot } of elementSlots) {
    const elementRef = `@Element${slot}`;
    let didReference = false;

    if (ref.id) {
      const tokenRegex = new RegExp(`\\[\\[asset:${ref.id.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\]\\]`, 'g');
      if (tokenRegex.test(prompt)) {
        prompt = prompt.replace(tokenRegex, elementRef);
        didReference = true;
      }
    }

    const nameRegex = ref.name ? new RegExp(`\\b${ref.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi') : null;
    if (nameRegex && nameRegex.test(prompt)) {
      // Name is in prompt → replace with element ref
      prompt = prompt.replace(nameRegex, elementRef);
      didReference = true;
    }

    if (!didReference) {
      // Name not in prompt → append context for the model
      if (ref.type === "character") {
        prompt += ` ${elementRef} is the main character in this scene - the only person who appears, speaks, and drives the action.`;
      } else {
        prompt += ` ${elementRef} is the featured product "${ref.name || 'product'}".`;
      }
    }
  }

  // CRITICAL disambiguation for UGC + product scenarios:
  // Fashion/apparel product images often feature a human model wearing the product.
  // Without explicit instruction, image-to-video models can confuse that model with
  // the ambassador (character), producing videos where the product-image-human
  // becomes the speaker. Tell Kling the product reference is the product ONLY,
  // and the character is the sole human performer.
  if (input.videoStyle === "UGC Ad" && !!character && products.length > 0) {
    prompt +=
      ` IMPORTANT: The product reference image (@Element2) is provided to show the product's appearance and details only. Any human figure visible in that reference is a mannequin/model - DO NOT use them as the character in the video. The only person who appears, moves, and speaks is @Element1 (the character), who is holding, wearing, or interacting with the product as described.`;
  }

  // Quality directive
  prompt += ` Ultra-high quality, no watermarks, no text overlays, smooth motion.`;

  // Cleanup legacy unresolved token artifacts if any remain.
  prompt = prompt.replace(/\[\[asset:[^\]]+\]\]/g, "").replace(/\s{2,}/g, " ").trim();

  // Brand context - only for short/generic prompts (Creative Studio usage)
  // Campaign videos already have brand context baked into the script generator output
  if (!isDetailedBrief) {
    const brandLines: string[] = [];
    if (input.brandName) brandLines.push(`Brand name: ${input.brandName}`);
    if (input.primaryColor) brandLines.push(`Brand color: ${input.primaryColor}`);
    if (input.brandTone) brandLines.push(`Brand tone: ${input.brandTone}.`);
    if (brandLines.length > 0) {
      prompt += `\n\n[Brand context]\n${brandLines.join("\n")}`;
    }
  }

  // Script generation constrains its own production brief, but presenter,
  // product-reference and quality instructions are added afterward. Enforce the
  // provider limit on the final payload while preserving both story setup and
  // the identity/safety instructions at the end.
  prompt = fitKlingPrompt(prompt);

  // Start image strategy:
  // - UGC Ad with a character → ALWAYS use the character image as start frame.
  //   This is the single biggest signal to the model that THIS person is the
  //   speaker, not any human that might appear in the product reference.
  // - Product Ads → prefer product image (hero shot of the product itself).
  // - Fallback chain: character → first product → null.
  const startImageUrl = input.videoStyle === "UGC Ad"
    ? (character?.imageUrl ?? products[0]?.imageUrl ?? null)
    : (products[0]?.imageUrl ?? character?.imageUrl ?? null);

  // ── Build elements array for image-to-video ──
  const elements = elementSlots
    .map(({ ref }) => {
      if (!ref.imageUrl) return null;
      return {
        frontal_image_url: ref.imageUrl,
        // Keep at least one reference image for Kling element identity locking.
        reference_image_urls: [ref.imageUrl],
      };
    })
    .filter(hasValue);

  return {
    model: hasRefs ? IMAGE_TO_VIDEO_MODEL : TEXT_TO_VIDEO_MODEL,
    prompt,
    startImageUrl,
    elements,
  };
}

export function fitKlingPrompt(prompt: string) {
  const compact = prompt.replace(/\s+/g, " ").trim();
  if (utf8Length(compact) <= KLING_PROMPT_MAX_BYTES) return compact;

  const omission = " ... ";
  const tail = takeUtf8Suffix(compact, 680).replace(/^\S*\s+/, "").trimStart();
  const headBudget = KLING_PROMPT_MAX_BYTES - utf8Length(tail) - utf8Length(omission);
  const head = takeUtf8Prefix(compact, headBudget).replace(/\s+\S*$/, "").trimEnd();
  return takeUtf8Prefix(`${head}${omission}${tail}`, KLING_PROMPT_MAX_BYTES);
}

function utf8Length(value: string) {
  return new TextEncoder().encode(value).length;
}

function takeUtf8Prefix(value: string, maxBytes: number) {
  let result = "";
  let bytes = 0;
  for (const character of value) {
    const size = utf8Length(character);
    if (bytes + size > maxBytes) break;
    result += character;
    bytes += size;
  }
  return result;
}

function takeUtf8Suffix(value: string, maxBytes: number) {
  const characters = [...value];
  let result = "";
  let bytes = 0;
  for (let index = characters.length - 1; index >= 0; index -= 1) {
    const character = characters[index];
    const size = utf8Length(character);
    if (bytes + size > maxBytes) break;
    result = character + result;
    bytes += size;
  }
  return result;
}

// ─── Runner ───────────────────────────────────────────────────────────────────

export async function runVideoGenerator(
  input: VideoGeneratorInput & {
    builtPrompt?: string;
    resolvedModel?: string;
    resolvedStartImageUrl?: string;
    resolvedElements?: KlingElementInput[];
  },
  falApiKey: string,
  webhookUrl?: string,
): Promise<{ requestId: string } | VideoGeneratorOutput> {
  fal.config({ credentials: falApiKey });

  let model: string;
  let prompt: string;
  let startImageUrl: string | null;
  let elements: KlingElementInput[];

  if (input.builtPrompt && input.resolvedModel) {
    prompt = fitKlingPrompt(input.builtPrompt);
    model = input.resolvedModel;
    startImageUrl = input.resolvedStartImageUrl ?? null;
    elements = input.resolvedElements ?? [];
  } else {
    const built = buildVideoPrompt(input);
    prompt = built.prompt;
    model = built.model;
    startImageUrl = built.startImageUrl;
    elements = built.elements;
  }

  // Retries can carry a built prompt persisted by an older deployment. Apply
  // the provider-safe limit again at the last boundary before fal.ai.
  prompt = fitKlingPrompt(prompt);

  const durationNumber = Number.parseInt(String(input.duration ?? "5"), 10);
  if (!Number.isInteger(durationNumber) || durationNumber < 3 || durationNumber > 15) {
    throw new Error("Kling Standard duration must be a whole number from 3 to 15 seconds.");
  }
  const duration = String(durationNumber);
  const aspectRatio = input.aspectRatio ?? "9:16";
  const generateAudio = input.generateAudio ?? true;
  const negative_prompt = "blur, distort, low quality, watermark, text overlay";

  // ── Build fal.ai input ──
  const falInput: Record<string, any> = {
    prompt,
    duration,
    generate_audio: generateAudio,
    aspect_ratio: aspectRatio,
    negative_prompt,
    cfg_scale: 0.5,
  };

  if (model === IMAGE_TO_VIDEO_MODEL) {
    if (!startImageUrl) {
      throw new Error("image-to-video requires a start_image_url but none was resolved");
    }
    falInput.start_image_url = startImageUrl;
    if (elements.length > 0) {
      falInput.elements = elements;
    }
  }

  // ── Webhook mode ──
  if (webhookUrl) {
    const result = await fal.queue.submit(model, {
      input: falInput,
      webhookUrl,
    });
    return { requestId: result.request_id };
  }

  // ── Polling mode (fallback) ──
  const result = await fal.subscribe(model, { input: falInput }) as any;
  return {
    videoUrl: result.video.url,
    prompt,
    model,
    generatedAt: Date.now(),
  };
}
