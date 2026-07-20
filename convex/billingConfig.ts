export const BILLING_CONFIG_VERSION = 13;

export type SeedPlan = {
  key: string;
  name: string;
  description?: string;
  priceMonthlyCents: number;
  currency: string;
  includedCredits: number;
  lowCreditThreshold: number;
  maxBrands: number;
  maxSeats: number;
  stripePriceId?: string;
  features: Record<string, any>;
  limits: Record<string, any>;
  isActive: boolean;
};

export type SeedSku = {
  key: string;
  label: string;
  provider: string;
  model: string;
  unitType: "request" | "image" | "second" | "angle" | "post" | "batch";
  providerCostPerUnitCents: number;
  creditValueOverrideCents?: number;
  markupOverride?: number;
  /** Legacy seed hint only. This is never persisted or trusted at runtime. */
  creditsPerUnit?: number;
  /** Legacy seed fields removed from persisted rows during v2 reseeding. */
  creditValueCents?: number;
  markup?: number;
  defaultCreditSource: "customer_balance" | "platform_covered";
  isActive: boolean;
  metadata?: Record<string, any>;
};

export type SeedTopUpPackage = {
  key: string;
  label: string;
  description?: string;
  credits: number;
  priceCents: number;
  currency: string;
  expiresAfterDays?: number;
  isActive: boolean;
};

export type SeedBillingSettings = {
  key: "global";
  trialDurationDays: number;
  trialCredits: number;
  trialLowCreditThreshold: number;
  trialTemplateLimit: number;
  trialTemplateRefreshEnabled: boolean;
  trialTemplateRefreshDays: number;
  trialTemplateAiCovers: boolean;
  templateBasePoolEvergreenTarget: number;
  templateBasePoolSeasonalEvergreenTarget: number;
  templateBasePoolSeasonalEventTarget: number;
  creditPurchaseInvoicePolicy: "receipt_only" | "always" | "on_request";
  requirePaymentMethodForTrial: boolean;
  allowTopUpsDuringTrial: boolean;
  oneTrialPerAccount: boolean;
  defaultCreditValueCents: number;
  defaultMarkup: number;
  isActive: boolean;
};

const env = typeof process !== "undefined" ? process.env : {};

export const DEFAULT_BILLING_SETTINGS: SeedBillingSettings = {
  key: "global",
  trialDurationDays: 5,
  trialCredits: 55,
  trialLowCreditThreshold: 10,
  trialTemplateLimit: 2,
  trialTemplateRefreshEnabled: false,
  trialTemplateRefreshDays: 0,
  trialTemplateAiCovers: false,
  templateBasePoolEvergreenTarget: 12,
  templateBasePoolSeasonalEvergreenTarget: 8,
  templateBasePoolSeasonalEventTarget: 4,
  creditPurchaseInvoicePolicy: "receipt_only",
  requirePaymentMethodForTrial: true,
  allowTopUpsDuringTrial: false,
  oneTrialPerAccount: true,
  defaultCreditValueCents: 10,
  defaultMarkup: 4,
  isActive: true,
};

export const DEFAULT_PLANS: SeedPlan[] = [
  {
    key: "starter",
    name: "Starter",
    description: "A solo founder testing campaigns for one brand.",
    priceMonthlyCents: 6500,
    currency: "USD",
    includedCredits: 600,
    lowCreditThreshold: 60,
    maxBrands: 1,
    maxSeats: 2,
    stripePriceId: env.STRIPE_PRICE_STARTER,
    features: {
      customAmbassadors: true,
      templateAiCovers: false,
      templateRefreshEnabled: false,
      monthlyRolloverCapMultiplier: 2,
    },
    limits: { concurrentAiJobs: 2, templateLimit: 4, templateRefreshDays: 0 },
    isActive: true,
  },
  {
    key: "growth",
    name: "Growth",
    description: "A growing brand or small team running campaigns consistently.",
    priceMonthlyCents: 19900,
    currency: "USD",
    includedCredits: 2000,
    lowCreditThreshold: 200,
    maxBrands: 3,
    maxSeats: 5,
    stripePriceId: env.STRIPE_PRICE_GROWTH,
    features: {
      customAmbassadors: true,
      templateAiCovers: true,
      templateRefreshEnabled: true,
      monthlyRolloverCapMultiplier: 2,
    },
    limits: { concurrentAiJobs: 4, templateLimit: 8, templateRefreshDays: 30 },
    isActive: true,
  },
  {
    key: "pro",
    name: "Pro",
    description: "Agencies managing multiple client brands.",
    priceMonthlyCents: 39900,
    currency: "USD",
    includedCredits: 4500,
    lowCreditThreshold: 450,
    maxBrands: 10,
    maxSeats: 10,
    stripePriceId: env.STRIPE_PRICE_PRO,
    features: {
      customAmbassadors: true,
      templateAiCovers: true,
      templateRefreshEnabled: true,
      monthlyRolloverCapMultiplier: 2,
    },
    limits: { concurrentAiJobs: 8, templateLimit: 12, templateRefreshDays: 14 },
    isActive: true,
  },
  {
    key: "internal",
    name: "Internal",
    description: "Trusted internal/admin testing plan. Usage is tracked but balance may be bypassed.",
    priceMonthlyCents: 0,
    currency: "USD",
    includedCredits: 0,
    lowCreditThreshold: 0,
    maxBrands: 999,
    maxSeats: 999,
    features: { creditBypass: true, customAmbassadors: true, templateAiCovers: true, templateRefreshEnabled: true },
    limits: { concurrentAiJobs: 20, templateLimit: 50, templateRefreshDays: 1 },
    isActive: true,
  },
];

export const DEFAULT_SKUS: SeedSku[] = [
  {
    key: "image.text_to_image.high",
    label: "Text to image - portrait or landscape",
    provider: "fal.ai",
    model: "fal-ai/gpt-image-1.5",
    unitType: "image",
    providerCostPerUnitCents: 20.5,
    creditValueCents: 10,
    markup: 4,
    creditsPerUnit: 9,
    defaultCreditSource: "customer_balance",
    isActive: true,
    metadata: { quality: "high", shape: "portrait_or_landscape", publishedImageCostCents: 20, tokenCostAllowanceCents: 0.5, pricingSource: "https://fal.ai/models/fal-ai/gpt-image-1.5", verifiedAt: "2026-06-22" },
  },
  {
    key: "image.text_to_image.high.square",
    label: "Text to image - square",
    provider: "fal.ai",
    model: "fal-ai/gpt-image-1.5",
    unitType: "image",
    providerCostPerUnitCents: 13.8,
    creditValueCents: 10,
    markup: 4,
    creditsPerUnit: 6,
    defaultCreditSource: "customer_balance",
    isActive: true,
    metadata: {
      quality: "high",
      shape: "square",
      publishedImageCostCents: 13.3,
      tokenCostAllowanceCents: 0.5,
      pricingSource: "https://fal.ai/models/fal-ai/gpt-image-1.5",
      verifiedAt: "2026-06-22",
    },
  },
  {
    key: "image.text_to_image.medium",
    label: "Text to image - medium portrait or landscape",
    provider: "fal.ai",
    model: "fal-ai/gpt-image-1.5",
    unitType: "image",
    providerCostPerUnitCents: 5.6,
    creditValueCents: 10,
    markup: 4,
    creditsPerUnit: 3,
    defaultCreditSource: "customer_balance",
    isActive: true,
    metadata: { quality: "medium", shape: "portrait_or_landscape", publishedImageCostCents: 5.1, tokenCostAllowanceCents: 0.5, pricingSource: "https://fal.ai/models/fal-ai/gpt-image-1.5", verifiedAt: "2026-06-22" },
  },
  {
    key: "image.text_to_image.medium.square",
    label: "Text to image - medium square",
    provider: "fal.ai",
    model: "fal-ai/gpt-image-1.5",
    unitType: "image",
    providerCostPerUnitCents: 3.9,
    creditValueCents: 10,
    markup: 4,
    creditsPerUnit: 2,
    defaultCreditSource: "customer_balance",
    isActive: true,
    metadata: { quality: "medium", shape: "square", publishedImageCostCents: 3.4, tokenCostAllowanceCents: 0.5, pricingSource: "https://fal.ai/models/fal-ai/gpt-image-1.5", verifiedAt: "2026-06-22" },
  },
  {
    key: "image.text_to_image.low",
    label: "Text to image - low portrait or landscape",
    provider: "fal.ai",
    model: "fal-ai/gpt-image-1.5",
    unitType: "image",
    providerCostPerUnitCents: 1.8,
    creditValueCents: 10,
    markup: 4,
    creditsPerUnit: 1,
    defaultCreditSource: "customer_balance",
    isActive: true,
    metadata: { quality: "low", shape: "portrait_or_landscape", publishedImageCostCents: 1.3, tokenCostAllowanceCents: 0.5, pricingSource: "https://fal.ai/models/fal-ai/gpt-image-1.5", verifiedAt: "2026-06-22" },
  },
  {
    key: "image.text_to_image.low.square",
    label: "Text to image - low square",
    provider: "fal.ai",
    model: "fal-ai/gpt-image-1.5",
    unitType: "image",
    providerCostPerUnitCents: 1.4,
    creditValueCents: 10,
    markup: 4,
    creditsPerUnit: 1,
    defaultCreditSource: "customer_balance",
    isActive: true,
    metadata: { quality: "low", shape: "square", publishedImageCostCents: 0.9, tokenCostAllowanceCents: 0.5, pricingSource: "https://fal.ai/models/fal-ai/gpt-image-1.5", verifiedAt: "2026-06-22" },
  },
  {
    key: "image.reference_edit.1k",
    label: "Reference image edit",
    provider: "fal.ai",
    model: "fal-ai/nano-banana-pro/edit",
    unitType: "image",
    providerCostPerUnitCents: 15,
    creditValueCents: 10,
    markup: 4,
    creditsPerUnit: 6,
    defaultCreditSource: "customer_balance",
    isActive: true,
    metadata: {
      resolution: "1K",
      pricingSource: "https://fal.ai/models/fal-ai/nano-banana-pro/edit",
      verifiedAt: "2026-06-22",
      legacyOnly: true,
      enableWebSearch: false,
    },
  },
  {
    key: "image.reference_edit.2k",
    label: "Reference image edit - 2K",
    provider: "fal.ai",
    model: "fal-ai/nano-banana-pro/edit",
    unitType: "image",
    providerCostPerUnitCents: 15,
    creditValueCents: 10,
    markup: 4,
    creditsPerUnit: 6,
    defaultCreditSource: "customer_balance",
    isActive: true,
    metadata: { resolution: "2K", pricingSource: "https://fal.ai/models/fal-ai/nano-banana-pro/edit", verifiedAt: "2026-06-22", enableWebSearch: false },
  },
  {
    key: "image.reference_edit.4k",
    label: "Reference image edit - 4K",
    provider: "fal.ai",
    model: "fal-ai/nano-banana-pro/edit",
    unitType: "image",
    providerCostPerUnitCents: 30,
    creditValueCents: 10,
    markup: 4,
    creditsPerUnit: 12,
    defaultCreditSource: "customer_balance",
    isActive: true,
    metadata: {
      resolution: "4K",
      pricingSource: "https://fal.ai/models/fal-ai/nano-banana-pro/edit",
      verifiedAt: "2026-06-22",
      enableWebSearch: false,
    },
  },
  {
    key: "video.kling.v3.standard.text_to_video.audio",
    label: "Kling text to video with audio",
    provider: "fal.ai",
    model: "fal-ai/kling-video/v3/standard/text-to-video",
    unitType: "second",
    providerCostPerUnitCents: 12.6,
    creditValueCents: 10,
    markup: 4,
    creditsPerUnit: 6,
    defaultCreditSource: "customer_balance",
    isActive: true,
    metadata: { generateAudio: true, pricingSource: "https://fal.ai/models/fal-ai/kling-video/v3/standard/text-to-video", verifiedAt: "2026-06-22", durationRangeSeconds: [3, 15] },
  },
  {
    key: "video.kling.v3.standard.text_to_video.no_audio",
    label: "Kling text to video",
    provider: "fal.ai",
    model: "fal-ai/kling-video/v3/standard/text-to-video",
    unitType: "second",
    providerCostPerUnitCents: 8.4,
    creditValueCents: 10,
    markup: 4,
    creditsPerUnit: 4,
    defaultCreditSource: "customer_balance",
    isActive: true,
    metadata: { generateAudio: false, pricingSource: "https://fal.ai/models/fal-ai/kling-video/v3/standard/text-to-video", verifiedAt: "2026-06-22", durationRangeSeconds: [3, 15] },
  },
  {
    key: "video.kling.v3.standard.image_to_video.audio",
    label: "Kling image to video with audio",
    provider: "fal.ai",
    model: "fal-ai/kling-video/v3/standard/image-to-video",
    unitType: "second",
    providerCostPerUnitCents: 12.6,
    creditValueCents: 10,
    markup: 4,
    creditsPerUnit: 6,
    defaultCreditSource: "customer_balance",
    isActive: true,
    metadata: { generateAudio: true, pricingSource: "https://fal.ai/models/fal-ai/kling-video/v3/standard/image-to-video", verifiedAt: "2026-06-22", durationRangeSeconds: [3, 15] },
  },
  {
    key: "video.kling.v3.standard.image_to_video.no_audio",
    label: "Kling image to video",
    provider: "fal.ai",
    model: "fal-ai/kling-video/v3/standard/image-to-video",
    unitType: "second",
    providerCostPerUnitCents: 8.4,
    creditValueCents: 10,
    markup: 4,
    creditsPerUnit: 4,
    defaultCreditSource: "customer_balance",
    isActive: true,
    metadata: { generateAudio: false, pricingSource: "https://fal.ai/models/fal-ai/kling-video/v3/standard/image-to-video", verifiedAt: "2026-06-22", durationRangeSeconds: [3, 15] },
  },
  {
    key: "video.kling.v3.standard.text_to_video.voice_control",
    label: "Kling text to video with voice control",
    provider: "fal.ai",
    model: "fal-ai/kling-video/v3/standard/text-to-video",
    unitType: "second",
    providerCostPerUnitCents: 15.4,
    creditValueCents: 10,
    markup: 4,
    creditsPerUnit: 7,
    defaultCreditSource: "customer_balance",
    isActive: false,
    metadata: { generateAudio: true, voiceControl: true, requiresVoiceIds: true, pricingSource: "https://fal.ai/models/fal-ai/kling-video/v3/standard/text-to-video", verifiedAt: "2026-06-22" },
  },
  {
    key: "video.kling.v3.standard.image_to_video.voice_control",
    label: "Kling image to video with voice control",
    provider: "fal.ai",
    model: "fal-ai/kling-video/v3/standard/image-to-video",
    unitType: "second",
    providerCostPerUnitCents: 15.4,
    creditValueCents: 10,
    markup: 4,
    creditsPerUnit: 7,
    defaultCreditSource: "customer_balance",
    isActive: false,
    metadata: { generateAudio: true, voiceControl: true, requiresVoiceIds: true, pricingSource: "https://fal.ai/models/fal-ai/kling-video/v3/standard/image-to-video", verifiedAt: "2026-06-22" },
  },
  {
    key: "text.campaign_script_per_angle",
    label: "Campaign script and caption",
    provider: "OpenRouter",
    model: "openai/gpt-4o-mini",
    unitType: "angle",
    providerCostPerUnitCents: 0.15,
    creditValueCents: 10,
    markup: 4,
    creditsPerUnit: 1,
    defaultCreditSource: "customer_balance",
    isActive: true,
  },
  {
    key: "text.campaign_attached_media_caption",
    label: "Attached-media campaign caption",
    provider: "OpenRouter",
    model: "openai/gpt-4o-mini",
    unitType: "angle",
    providerCostPerUnitCents: 0.15,
    creditValueCents: 10,
    markup: 4,
    creditsPerUnit: 1,
    defaultCreditSource: "customer_balance",
    isActive: true,
  },
  {
    key: "text.caption_regeneration",
    label: "Caption regeneration",
    provider: "OpenRouter",
    model: "openai/gpt-4o-mini",
    unitType: "request",
    providerCostPerUnitCents: 0.15,
    creditValueCents: 10,
    markup: 4,
    creditsPerUnit: 1,
    defaultCreditSource: "customer_balance",
    isActive: true,
  },
  {
    key: "text.planner_caption",
    label: "Planner caption",
    provider: "OpenRouter",
    model: "openai/gpt-4o-mini",
    unitType: "request",
    providerCostPerUnitCents: 0.15,
    creditValueCents: 10,
    markup: 4,
    creditsPerUnit: 1,
    defaultCreditSource: "customer_balance",
    isActive: true,
  },
  {
    key: "text.content_planner_weekly_plan",
    label: "Weekly content plan",
    provider: "OpenRouter",
    model: "openai/gpt-4o-mini",
    unitType: "batch",
    providerCostPerUnitCents: 0.6,
    creditValueCents: 10,
    markup: 4,
    creditsPerUnit: 1,
    defaultCreditSource: "customer_balance",
    isActive: true,
    metadata: { batchSize: 3, maxPosts: 7 },
  },
  {
    key: "text.scheduling_suggestions",
    label: "AI scheduling suggestions",
    provider: "OpenRouter",
    model: "openai/gpt-4o-mini",
    unitType: "request",
    providerCostPerUnitCents: 0.15,
    creditValueCents: 10,
    markup: 4,
    creditsPerUnit: 1,
    defaultCreditSource: "customer_balance",
    isActive: true,
  },
  {
    key: "text.ai_assistant_message",
    label: "AI assistant message",
    provider: "OpenRouter",
    model: "openai/gpt-4o-mini",
    unitType: "request",
    providerCostPerUnitCents: 0.15,
    creditValueCents: 10,
    markup: 4,
    creditsPerUnit: 1,
    defaultCreditSource: "customer_balance",
    isActive: true,
  },
  {
    key: "text.campaign_angle_batch",
    label: "Campaign angle batch",
    provider: "OpenRouter",
    model: "openai/gpt-4o-mini",
    unitType: "batch",
    providerCostPerUnitCents: 0.6,
    creditValueCents: 10,
    markup: 4,
    creditsPerUnit: 1,
    defaultCreditSource: "customer_balance",
    isActive: true,
    metadata: { batchSize: 4 },
  },
  {
    key: "ambassador.custom_generation",
    label: "Custom AI ambassador",
    provider: "fal.ai",
    model: "fal-ai/gpt-image-1.5",
    unitType: "request",
    providerCostPerUnitCents: 13.4,
    creditValueCents: 10,
    markup: 4,
    creditsPerUnit: 9,
    defaultCreditSource: "customer_balance",
    isActive: true,
  },
  {
    key: "onboarding.brand_guide_analyzer",
    label: "Brand guide analyzer",
    provider: "OpenRouter",
    model: "google/gemini-2.5-flash",
    unitType: "request",
    providerCostPerUnitCents: 0.55,
    creditValueCents: 10,
    markup: 4,
    creditsPerUnit: 1,
    defaultCreditSource: "customer_balance",
    isActive: true,
  },
  {
    key: "onboarding.brand_tone_image",
    label: "Brand tone image analysis",
    provider: "OpenRouter",
    model: "openai/gpt-4o-mini",
    unitType: "request",
    providerCostPerUnitCents: 0.15,
    creditValueCents: 10,
    markup: 4,
    creditsPerUnit: 1,
    defaultCreditSource: "customer_balance",
    isActive: true,
  },
  {
    key: "template.base_pool_generation",
    label: "Base campaign template generation",
    provider: "OpenRouter",
    model: "openai/gpt-4o-mini",
    unitType: "request",
    providerCostPerUnitCents: 0.6,
    creditValueCents: 10,
    markup: 4,
    creditsPerUnit: 2,
    defaultCreditSource: "platform_covered",
    isActive: true,
  },
  {
    key: "template.cover_image",
    label: "Template cover image",
    provider: "fal.ai",
    model: "fal-ai/gpt-image-1.5",
    unitType: "image",
    providerCostPerUnitCents: 20.1,
    creditValueCents: 10,
    markup: 4,
    creditsPerUnit: 9,
    defaultCreditSource: "platform_covered",
    isActive: true,
  },
  {
    key: "template.personalization",
    label: "Template personalization",
    provider: "OpenRouter",
    model: "openai/gpt-4o-mini",
    unitType: "request",
    providerCostPerUnitCents: 0.6,
    creditValueCents: 10,
    markup: 4,
    creditsPerUnit: 2,
    defaultCreditSource: "platform_covered",
    isActive: true,
  },
];

export const DEFAULT_TOP_UP_PACKAGES: SeedTopUpPackage[] = [
  {
    key: "starter_credits",
    label: "Starter Top-up",
    description: "A light refill for a few extra images or captions.",
    credits: 100,
    priceCents: 1000,
    currency: "USD",
    expiresAfterDays: undefined,
    isActive: true,
  },
  {
    key: "growth_credits",
    label: "Growth Top-up",
    description: "A practical refill for an active campaign sprint.",
    credits: 500,
    priceCents: 5000,
    currency: "USD",
    expiresAfterDays: undefined,
    isActive: true,
  },
  {
    key: "scale_credits",
    label: "Scale Top-up",
    description: "A larger pool for teams producing content at volume.",
    credits: 1500,
    priceCents: 15000,
    currency: "USD",
    expiresAfterDays: undefined,
    isActive: true,
  },
];
