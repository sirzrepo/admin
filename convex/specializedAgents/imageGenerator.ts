/**
 * Image Generator - Specialized Agent (Pure Function)
 *
 * Zero Convex dependency. Zero side-effects beyond calling fal.ai.
 *
 * Smart model switching:
 *  - No asset references → fal-ai/gpt-image-1.5  (text-to-image)
 *  - Asset references present → fal-ai/nano-banana-pro/edit (image-to-image)
 */

import * as fal from "@fal-ai/serverless-client";
import type { ImageGeneratorInput, ImageGeneratorOutput } from "./types";

const TEXT_TO_IMAGE_MODEL = "fal-ai/gpt-image-1.5";
const IMAGE_TO_IMAGE_MODEL = "fal-ai/nano-banana-pro/edit";

// ─── Prompt Builder ───────────────────────────────────────────────────────────

export function buildImagePrompt(input: ImageGeneratorInput): {
  model: string;
  prompt: string;
  imageUrls: string[];
} {
  const refs = input.assetReferences ?? [];
  const imageUrls: string[] = [];

  // Collect image URLs from all referenced assets
  for (const ref of refs) {
    if (ref.imageUrl) imageUrls.push(ref.imageUrl);
  }

  const hasRefs = imageUrls.length > 0;

  // Build the base prompt - start purely from what the user typed
  let prompt = input.prompt.trim();

  // Append style directive only if the user explicitly selected a style
  if (input.style) {
    const styleMap: Record<string, string> = {
      "Product Shot": "Studio product photography, professional lighting with soft shadows, commercial quality.",
      "Lifestyle": "Authentic lifestyle photography, natural setting, warm and aspirational mood, real-world context.",
      "UGC": "User-generated content style, casual smartphone aesthetic, natural lighting, authentic feel.",
      "Cinematic": "Cinematic photography, dramatic lighting, wide-angle composition, film-grade color grading, shallow depth of field.",
      "Flat Lay": "Overhead flat-lay composition, organized layout, clean surface, even soft lighting.",
      "Hero Shot": "Product hero shot, dramatic rim lighting, dark or gradient background, premium commercial feel.",
    };
    const styleDirective = styleMap[input.style] || `Style: ${input.style}.`;
    prompt += ` ${styleDirective}`;
  } else {
    prompt += ` Clean neutral background, natural even lighting, minimal distractions.`;
  }

  // Enrich with referenced assets
  for (const ref of refs) {
    if (ref.type === "character") {
      prompt += ` The main subject is the brand character "${ref.name}".`;
      if (ref.description) prompt += ` ${ref.description}.`;
    } else if (ref.type === "product") {
      prompt += ` Feature the product "${ref.name}" prominently.`;
      if (ref.description) prompt += ` ${ref.description}.`;
    }
  }

  // Quality + negative prompts
  prompt += ` Ultra-high quality, commercial grade. Never include: watermarks, text overlays, logos, distorted anatomy, blurry areas, artifacts, extra limbs, deformed features.`;

  // ── Brand context reference card ──────────────────────────────────────────────
  // Append brand info as a passive reference block. The AI is explicitly told to
  // only use these values if the user's prompt above referenced them (e.g. "brand
  // colour", "our brand name"). This avoids forcing brand identity on every image
  // while still making the data available when the user asks for it.
  const brandLines: string[] = [];
  if (input.brandName) brandLines.push(`Brand name: ${input.brandName}`);
  if (input.primaryColor) brandLines.push(`Brand color: ${input.primaryColor}`);
  if (input.brandTone) brandLines.push(`Brand tone: ${input.brandTone}. The visual mood should reflect this.`);

  if (brandLines.length > 0) {
    prompt += `\n\n[Brand context]\n${brandLines.join("\n")}`;
  }

  return {
    model: hasRefs ? IMAGE_TO_IMAGE_MODEL : TEXT_TO_IMAGE_MODEL,
    prompt,
    imageUrls,
  };
}

// ─── Runner ───────────────────────────────────────────────────────────────────

export async function runImageGenerator(
  input: ImageGeneratorInput & { builtPrompt?: string; resolvedModel?: string; resolvedImageUrls?: string[] },
  falApiKey: string,
  webhookUrl?: string,
): Promise<{ requestId: string } | ImageGeneratorOutput> {
  fal.config({ credentials: falApiKey });

  // Use pre-built prompt if saved (from a previous patchTask call), else build now
  let model: string;
  let prompt: string;
  let imageUrls: string[];

  if (input.builtPrompt && input.resolvedModel) {
    prompt = input.builtPrompt;
    model = input.resolvedModel;
    imageUrls = input.resolvedImageUrls ?? [];
  } else {
    const built = buildImagePrompt(input);
    prompt = built.prompt;
    model = built.model;
    imageUrls = built.imageUrls;
  }

  const aspectRatio = input.aspectRatio ?? "9:16";

  // ── Build fal.ai input based on model ──
  const falInput: Record<string, any> = { prompt };

  if (model === IMAGE_TO_IMAGE_MODEL) {
    // nano-banana-pro/edit - image-to-image
    falInput.image_urls = imageUrls;
    falInput.aspect_ratio = aspectRatio;
    falInput.resolution = input.resolution === "1K" || input.resolution === "4K" ? input.resolution : "2K";
    falInput.output_format = "png";
    falInput.num_images = 1;
    falInput.limit_generations = true;
    falInput.enable_web_search = false;
  } else {
    // gpt-image-1.5 - text-to-image; map aspect ratio to supported sizes
    const gptSizeMap: Record<string, string> = {
      "9:16": "1024x1536",
      "4:5": "1024x1536",
      "16:9": "1536x1024",
      "21:9": "1536x1024",
      "4:3": "1536x1024",
      "3:2": "1536x1024",
      "1:1": "1024x1024",
    };
    falInput.image_size = gptSizeMap[aspectRatio] ?? "1024x1024";
    falInput.quality = input.quality ?? "high";
    falInput.output_format = "png";
    falInput.num_images = 1;
    falInput.background = "auto";
  }

  // ── Webhook mode (primary) ──
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
    imageUrl: result.images[0].url,
    prompt,
    model,
    generatedAt: Date.now(),
  };
}
