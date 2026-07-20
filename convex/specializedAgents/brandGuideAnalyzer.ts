/**
 * Brand Guide Analyzer - Specialized Agent (Pure Function)
 *
 * Reads an uploaded brand guide (PDF/DOCX/MD/HTML) from R2 and uses Gemini
 * (multimodal for PDFs, text for everything else) to extract a structured
 * JSON of brand fields. The shape mirrors the form fields the user would
 * have filled in manually, so the resulting brand draft can be reviewed and
 * edited on Step 6 (Review & Finalize).
 *
 * Notes:
 * - Industry / interests are constrained to known IDs from the v2 in-app
 *   constants so the extracted value lines up with the dropdown / chips.
 * - All fields are optional in the output - partial extractions are
 *   acceptable; the user fills in gaps on Review.
 * - This action does NOT write to the DB. The task runner stores the result
 *   on the `agentTasks` row; the frontend then calls a mutation to apply it
 *   to the brand draft (so the user has a chance to review).
 */

import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateObject } from "ai";
import { z } from "zod";

export type BrandGuideAnalyzerInput = {
  /** Public R2 URL of the uploaded brand guide. */
  fileUrl: string;
  /** MIME type from the upload (e.g. "application/pdf"). */
  mediaType: string;
  /** Original file name (for logging / error messages). */
  fileName: string;
  /** Optional brand name we already know (signup company name). Helps the LLM
   *  disambiguate when the document references multiple entities. */
  knownBrandName?: string;
};

export type BrandGuideAnalyzerOutput = {
  extracted: {
    name?: string;
    tagline?: string;
    description?: string;
    primaryColor?: string;
    secondaryColor?: string;
    brandTone?: string;
    targetAudience?: string;
    interests?: string[];
    industry?: string;
  };
  /** Whether anything was successfully extracted. */
  hasContent: boolean;
};

// ─── Zod schema for structured output ────────────────────────────────────────

const extractedSchema = z.object({
  name: z.string().nullable().describe("Brand name as it appears in the document. Null if not stated."),
  tagline: z.string().nullable().describe("Short tagline or slogan, under 60 chars. Null if not stated."),
  description: z.string().nullable().describe("1-3 sentence brand description in the brand's own voice. Null if not stated."),
  primaryColor: z.string().nullable().describe("Primary brand color as a hex code (e.g. '#3752E9'). Null if not stated or not parseable."),
  secondaryColor: z.string().nullable().describe("Secondary brand color as hex. Null if not present."),
  brandTone: z.string().nullable().describe("Brand voice/tone in 1-2 short sentences (e.g. 'Warm, knowledgeable, and grounded. Speaks like a thoughtful friend.'). Null if not derivable."),
  targetAudience: z.string().nullable().describe("Free-text target audience description, including age, lifestyle, values. Null if not stated."),
  interests: z.array(z.string()).describe("List of audience interest tags. Use ONLY these exact strings, pick 0-5: Skincare, Beauty & Makeup, Wellness, Fitness, Fashion & Style, Technology, Travel, Food & Cooking, Parenting, Finance, Gaming, Photography, Music, Arts & DIY, Sustainability, Pets, Sports, Home & Interior, Self-Care, Luxury & Lifestyle. Empty array if none apply."),
  industry: z.string().nullable().describe("Industry. Use ONLY one of these exact IDs or null: fashion, beauty, skincare, personal_care, jewelry, health, fitness, food, home, baby_kids, pet_care, electronics, sports_outdoors, automotive, luxury, arts_crafts, books, music, photography, gaming, tech, education, finance, travel, real_estate, entertainment, sustainability, nonprofit, other"),
});

// ─── Runner ──────────────────────────────────────────────────────────────────

export async function runBrandGuideAnalyzer(
  input: BrandGuideAnalyzerInput,
): Promise<BrandGuideAnalyzerOutput> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not configured.");
  }

  const openrouter = createOpenRouter({ apiKey });
  const model = openrouter("google/gemini-2.5-flash");

  const systemPrompt =
    "You are a brand strategist. Extract structured brand information from the provided brand guide document. " +
    "Be precise - only return values that are explicitly stated or strongly implied by the document. " +
    "Set fields to null if not present rather than guessing. " +
    "For colors, only return values if hex codes (or convertible color names like 'cobalt blue') appear. " +
    "For industry and interests, use ONLY the allowed enum values from the schema descriptions.";

  const userInstruction = input.knownBrandName
    ? `Extract brand info from this document. The brand we're onboarding is "${input.knownBrandName}" - focus on details about this entity if multiple are mentioned.`
    : `Extract brand info from this document.`;

  // Fetch the file as binary so we can pass it to the model. Gemini handles
  // PDFs natively; for DOCX / MD / HTML we still pass the file and let Gemini
  // parse what it can (DOCX has unreliable raw-binary parsing - best-effort).
  const fileRes = await fetch(input.fileUrl);
  if (!fileRes.ok) {
    throw new Error(`Failed to download brand guide (${fileRes.status}): ${input.fileName}`);
  }
  const fileBuffer = new Uint8Array(await fileRes.arrayBuffer());

  // Resolve media type: AI SDK + Gemini supports application/pdf natively.
  // For text-based files, send as text/plain so Gemini can read them directly.
  const isText =
    input.mediaType.startsWith("text/") ||
    input.mediaType === "text/markdown" ||
    input.mediaType === "text/html" ||
    input.fileName.endsWith(".md") ||
    input.fileName.endsWith(".html");

  const filePart = isText
    ? {
        type: "text" as const,
        text: new TextDecoder().decode(fileBuffer),
      }
    : {
        type: "file" as const,
        data: fileBuffer,
        mediaType: input.mediaType || "application/pdf",
      };

  const result = await generateObject({
    model,
    schema: extractedSchema,
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: userInstruction },
          filePart,
        ],
      },
    ],
    maxRetries: 1,
  });

  // Strip nulls from the output so patchDraft doesn't overwrite good fields
  // with empty values. Convert "" → undefined as well.
  const o = result.object;
  const clean = (s: string | null | undefined) =>
    s && typeof s === "string" && s.trim() ? s.trim() : undefined;

  const extracted: BrandGuideAnalyzerOutput["extracted"] = {
    name: clean(o.name),
    tagline: clean(o.tagline),
    description: clean(o.description),
    primaryColor: clean(o.primaryColor),
    secondaryColor: clean(o.secondaryColor),
    brandTone: clean(o.brandTone),
    targetAudience: clean(o.targetAudience),
    interests: o.interests?.length ? o.interests : undefined,
    industry: clean(o.industry),
  };

  const hasContent = Object.values(extracted).some((v) => v !== undefined);

  return { extracted, hasContent };
}
