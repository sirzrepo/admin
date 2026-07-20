import { internalMutation } from "../_generated/server";

// ─── Preset Tone Data ─────────────────────────────────────────────────────────
// Each preset has a short label (shown as pill) and a detailed value
// (populated into the voice statement textarea when selected).

const PRESET_TONES = [
  {
    label: "Friendly",
    value: "Warm, approachable, and genuinely helpful. We talk to customers like a trusted friend - casual but knowledgeable, encouraging without being pushy. Every interaction feels personal and relatable.",
    order: 1,
  },
  {
    label: "Bold",
    value: "Direct, confident, and unapologetic. We say what we mean and back it up with results. No fluff, no hedging - just clear conviction in what we offer and why it matters.",
    order: 2,
  },
  {
    label: "Premium",
    value: "Refined, deliberate, and effortlessly elevated. We speak with quiet confidence - never boastful, always assured. Every word is chosen with care, reflecting the quality and craftsmanship behind everything we do.",
    order: 3,
  },
  {
    label: "Scientific",
    value: "Evidence-led and precise. We let the data do the talking - citing research, explaining mechanisms, and never overclaiming. Customers trust us because we respect their intelligence and back every claim.",
    order: 4,
  },
  {
    label: "Playful",
    value: "Fun, energetic, and a little unexpected. We don't take ourselves too seriously, and that's the point. Our voice is vibrant and irreverent - always on-brand, never boring, with a wink at every turn.",
    order: 5,
  },
  {
    label: "Minimalist",
    value: "Less is more. We communicate with economy and intention - no excess words, no noise. Clean, calm, and considered. The space between the words matters as much as the words themselves.",
    order: 6,
  },
  {
    label: "Empowering",
    value: "Uplifting, motivational, and purpose-driven. We believe in our customers and show it. Every message encourages action, celebrates progress, and reminds people they're capable of more.",
    order: 7,
  },
  {
    label: "Edgy",
    value: "Provocative, sharp, and culturally aware. We challenge norms and speak to the audience that's tired of the same thing. Not reckless - intentionally disruptive with a clear point of view.",
    order: 8,
  },
  {
    label: "Conversational",
    value: "Natural, relaxed, and real. We sound like a DM from someone you actually like. No corporate jargon, no performative enthusiasm - just honest, easy communication that feels like a real conversation.",
    order: 9,
  },
  {
    label: "Authoritative",
    value: "Knowledgeable, trustworthy, and commanding. We lead the conversation - not with arrogance, but with deep expertise. When we speak, people listen because we've earned that credibility.",
    order: 10,
  },
];

// ─── seedTonePresets ──────────────────────────────────────────────────────────
// Internal mutation. Inserts all presets if they don't already exist.
// Run once after initial deploy from Convex dashboard:
//   data/seedTonePresets:seedTonePresets({})

export const seedTonePresets = internalMutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db.query("tonePresets").collect();
    const existingLabels = new Set(existing.map((p) => p.label));

    const now = Date.now();
    let inserted = 0;

    for (const preset of PRESET_TONES) {
      if (existingLabels.has(preset.label)) continue;
      await ctx.db.insert("tonePresets", { ...preset, isActive: true, createdAt: now });
      inserted++;
    }

    return { inserted, skipped: PRESET_TONES.length - inserted };
  },
});
