/**
 * Retail marketing event calendar with accurate industry targeting.
 *
 * Every event specifies:
 * - `countries`: which country codes this event drives retail activity in.
 *                undefined = global (all brands).
 * - `industries`: exact industries that measurably run campaigns during this
 *                 event (NOT "all" - we avoid lazy defaults that waste AI credits).
 * - `duration`: days the campaign window is active after the event start.
 * - `type`: "holiday" | "season" | "event" | "cultural" | "commercial".
 *
 * Data sources (NRF, BoF, WWD, Shopify, Klaviyo, Barclays, Alizila, CAIT India).
 * See /plans/ or commit history for the research audit.
 *
 * HOW TO ADD A NEW EVENT:
 * 1. Decide the date rule (fixed, moveable-simple, or moveable-per-year).
 * 2. Add to getHolidayCalendar(year) with accurate industries + countries.
 * 3. For moveable events that can't be algorithmically computed (Ramadan,
 *    Diwali, Lunar New Year), extend the MOVEABLE_EVENT_DATES table below.
 */

export interface HolidayEvent {
  name: string;
  month: number;
  day: number;
  duration: number; // days the campaign window is active
  type: "holiday" | "season" | "event" | "cultural" | "commercial";
  industries: string[]; // exact industries - never "all"
  countries?: string[]; // ISO country codes. undefined = global.
}

// ─── Moveable-date algorithms (deterministic) ─────────────────────────────

/** Easter Sunday - Anonymous Gregorian algorithm. Works for any year. */
function getEasterDate(year: number): { month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

/** Mother's Day US - 2nd Sunday in May */
function getMothersDayUS(year: number): { month: number; day: number } {
  const firstDayOfMay = new Date(year, 4, 1).getDay();
  const firstSunday = firstDayOfMay === 0 ? 1 : 8 - firstDayOfMay;
  return { month: 5, day: firstSunday + 7 };
}

/** Mothering Sunday UK - 4th Sunday of Lent = 3 weeks before Easter */
function getMothersDayUK(year: number): { month: number; day: number } {
  const easter = getEasterDate(year);
  const easterDate = new Date(year, easter.month - 1, easter.day);
  const motheringSunday = new Date(easterDate.getTime() - 21 * 24 * 60 * 60 * 1000);
  return { month: motheringSunday.getMonth() + 1, day: motheringSunday.getDate() };
}

/** Father's Day (US/UK/Canada) - 3rd Sunday in June */
function getFathersDay(year: number): { month: number; day: number } {
  const firstDayOfJune = new Date(year, 5, 1).getDay();
  const firstSunday = firstDayOfJune === 0 ? 1 : 8 - firstDayOfJune;
  return { month: 6, day: firstSunday + 14 };
}

/** Memorial Day (US) - last Monday in May */
function getMemorialDay(year: number): { month: number; day: number } {
  const lastDayOfMay = new Date(year, 5, 0);
  const dayOfWeek = lastDayOfMay.getDay();
  const lastMonday = lastDayOfMay.getDate() - ((dayOfWeek + 6) % 7);
  return { month: 5, day: lastMonday };
}

/** Labor Day (US) - 1st Monday in September */
function getLaborDay(year: number): { month: number; day: number } {
  const firstDayOfSep = new Date(year, 8, 1).getDay();
  const firstMonday = firstDayOfSep === 0 ? 2 : firstDayOfSep === 1 ? 1 : 9 - firstDayOfSep;
  return { month: 9, day: firstMonday };
}

/** Thanksgiving US - 4th Thursday in November */
function getThanksgivingUS(year: number): { month: number; day: number } {
  const firstDayOfNov = new Date(year, 10, 1).getDay();
  const firstThursday = firstDayOfNov <= 4 ? 5 - firstDayOfNov : 12 - firstDayOfNov;
  return { month: 11, day: firstThursday + 21 };
}

/** Black Friday - day after US Thanksgiving */
function getBlackFriday(year: number): { month: number; day: number } {
  const tg = getThanksgivingUS(year);
  return { month: 11, day: tg.day + 1 };
}

/** Cyber Monday - Monday after Black Friday */
function getCyberMonday(year: number): { month: number; day: number } {
  const bf = getBlackFriday(year);
  const date = new Date(year, bf.month - 1, bf.day + 3);
  return { month: date.getMonth() + 1, day: date.getDate() };
}

/** Super Bowl - 2nd Sunday in February */
function getSuperBowl(year: number): { month: number; day: number } {
  const firstDayOfFeb = new Date(year, 1, 1).getDay();
  const firstSunday = firstDayOfFeb === 0 ? 1 : 8 - firstDayOfFeb;
  return { month: 2, day: firstSunday + 7 };
}

// ─── Moveable events that require per-year tables ─────────────────────────
// Religious/lunar calendars that don't have a clean algorithm in pure JS.
// Extend this table yearly. Source: standard calendar references.

interface PerYearDates {
  ramadanStart: { month: number; day: number };
  eidAlFitr: { month: number; day: number };
  eidAlAdha: { month: number; day: number };
  lunarNewYear: { month: number; day: number };
  diwali: { month: number; day: number };
  hanukkahStart: { month: number; day: number };
  primeDay: { month: number; day: number };
}

const MOVEABLE_EVENT_DATES: Record<number, PerYearDates> = {
  2026: {
    ramadanStart: { month: 2, day: 17 },
    eidAlFitr: { month: 3, day: 19 },
    eidAlAdha: { month: 5, day: 26 },
    lunarNewYear: { month: 2, day: 17 },
    diwali: { month: 11, day: 8 },
    hanukkahStart: { month: 12, day: 4 },
    primeDay: { month: 7, day: 14 },
  },
  2027: {
    ramadanStart: { month: 2, day: 6 },
    eidAlFitr: { month: 3, day: 8 },
    eidAlAdha: { month: 5, day: 15 },
    lunarNewYear: { month: 2, day: 6 },
    diwali: { month: 10, day: 29 },
    hanukkahStart: { month: 12, day: 24 },
    primeDay: { month: 7, day: 13 },
  },
  2028: {
    ramadanStart: { month: 1, day: 26 },
    eidAlFitr: { month: 2, day: 25 },
    eidAlAdha: { month: 5, day: 4 },
    lunarNewYear: { month: 1, day: 26 },
    diwali: { month: 11, day: 17 },
    hanukkahStart: { month: 12, day: 12 },
    primeDay: { month: 7, day: 11 },
  },
};

// ─── Country code conventions ──────────────────────────────────────────────
// US, GB (UK), CA, AU, NZ, IE, IN, CN, JP, KR, SG, MY, ID, TH, VN, PH,
// AE, SA, QA, KW, BH, OM, EG, MA, TR (MENA), DE, FR, IT, ES (EU), BR, MX.

// Convenience country groupings for events
const COMMONWEALTH_ENGLISH = ["GB", "CA", "AU", "NZ", "IE", "ZA"];
const US_CA_AU = ["US", "CA", "AU"];
const WESTERN_CHRISTIAN = ["US", "GB", "CA", "AU", "NZ", "IE", "DE", "FR", "IT", "ES", "BR", "MX"];
const MENA = ["AE", "SA", "QA", "KW", "BH", "OM", "EG", "MA", "TR"];
const MUSLIM_POPULATIONS = [...MENA, "ID", "MY", "PK", "BD", "GB", "FR", "DE", "US"];
const SOUTH_ASIAN = ["IN", "NP", "LK", "SG", "MY", "MU", "FJ", "GB", "US", "CA"];
const ASIA_PACIFIC = ["CN", "TW", "HK", "SG", "MY", "VN", "KR", "ID", "TH", "PH", "JP"];

// ─── Build the full calendar for a given year ──────────────────────────────

export function getHolidayCalendar(year: number): HolidayEvent[] {
  const easter = getEasterDate(year);
  const mothersDayUS = getMothersDayUS(year);
  const mothersDayUK = getMothersDayUK(year);
  const memorialDay = getMemorialDay(year);
  const fathersDay = getFathersDay(year);
  const laborDay = getLaborDay(year);
  const thanksgiving = getThanksgivingUS(year);
  const blackFriday = getBlackFriday(year);
  const cyberMonday = getCyberMonday(year);
  const superBowl = getSuperBowl(year);

  const perYear = MOVEABLE_EVENT_DATES[year];

  const events: HolidayEvent[] = [
    // ── JANUARY ──
    {
      name: "New Year",
      month: 1,
      day: 1,
      duration: 14,
      type: "holiday",
      // Resolutions drive fitness, health, finance. Beauty for "new year, new you"
      // glam. Food for party. Entertainment for NYE streaming/events.
      industries: ["fitness", "health", "beauty", "food", "entertainment", "finance"],
      // Global celebration
    },

    // ── FEBRUARY ──
    {
      name: "Super Bowl",
      month: superBowl.month,
      day: superBowl.day,
      duration: 7,
      type: "event",
      industries: ["food", "entertainment", "automotive", "tech", "finance"],
      countries: ["US", "CA"],
    },
    {
      name: "Valentine's Day",
      month: 2,
      day: 14,
      duration: 5,
      type: "holiday",
      // NRF 2026: $29.1B - jewelry #1 ($7B), food #2, fashion, beauty/skincare, pet_care
      industries: ["jewelry", "food", "fashion", "beauty", "skincare", "pet_care", "luxury"],
      countries: ["US", "GB", "CA", "AU", "IE", "FR", "DE", "IT", "ES", "JP", "KR"],
    },

    // ── FEBRUARY / MARCH - moveable cultural ──
    ...(perYear ? [
      {
        name: "Lunar New Year",
        month: perYear.lunarNewYear.month,
        day: perYear.lunarNewYear.day,
        duration: 15,
        type: "cultural" as const,
        // Luxury, beauty, skincare, fashion, jewelry (gold gifting), food, travel
        industries: ["luxury", "beauty", "skincare", "fashion", "jewelry", "food", "travel"],
        countries: ASIA_PACIFIC,
      },
    ] : []),
    {
      name: "International Women's Day",
      month: 3,
      day: 8,
      duration: 7,
      type: "cultural",
      // Commercial in CN/Eastern Europe, values-driven in West
      industries: ["beauty", "skincare", "fashion", "jewelry", "nonprofit", "finance"],
      // Global
    },
    {
      name: "St. Patrick's Day",
      month: 3,
      day: 17,
      duration: 3,
      type: "holiday",
      industries: ["food", "entertainment"],
      countries: ["IE", "US", "GB", "CA", "AU"],
    },
    {
      name: "Mother's Day (UK)",
      month: mothersDayUK.month,
      day: mothersDayUK.day,
      duration: 7,
      type: "holiday",
      // Same industries as US Mother's Day but UK-dated (Mothering Sunday)
      industries: ["jewelry", "food", "beauty", "skincare", "fashion", "home", "baby_kids"],
      countries: ["GB", "IE"],
    },

    // ── MARCH / APRIL - Ramadan + Easter ──
    ...(perYear ? [
      {
        name: "Ramadan",
        month: perYear.ramadanStart.month,
        day: perYear.ramadanStart.day,
        duration: 30,
        type: "cultural" as const,
        industries: ["food", "fashion", "beauty", "skincare", "home", "travel"],
        countries: MUSLIM_POPULATIONS,
      },
      {
        name: "Eid al-Fitr",
        month: perYear.eidAlFitr.month,
        day: perYear.eidAlFitr.day,
        duration: 5,
        type: "cultural" as const,
        // Eid gifting is jewelry-heavy (gold tradition in Gulf)
        industries: ["fashion", "jewelry", "beauty", "food", "home", "baby_kids"],
        countries: MUSLIM_POPULATIONS,
      },
    ] : []),
    {
      name: "Easter",
      month: easter.month,
      day: easter.day,
      duration: 5,
      type: "holiday",
      // NRF 2025: $23.6B - food dominant, baby_kids (baskets), fashion (Easter outfits), arts_crafts, home
      industries: ["food", "baby_kids", "fashion", "arts_crafts", "home"],
      countries: WESTERN_CHRISTIAN,
    },
    {
      name: "Earth Day",
      month: 4,
      day: 22,
      duration: 5,
      type: "cultural",
      industries: ["sustainability", "fashion", "beauty", "sports_outdoors", "home", "nonprofit"],
      // Global
    },

    // ── MAY ──
    {
      name: "Mother's Day",
      month: mothersDayUS.month,
      day: mothersDayUS.day,
      duration: 7,
      type: "holiday",
      // NRF 2025: $34.1B - jewelry #1 ($6.8B), food, beauty/skincare/personal_care, fashion, home, baby_kids
      industries: ["jewelry", "food", "beauty", "skincare", "personal_care", "fashion", "home", "baby_kids"],
      countries: US_CA_AU,
    },
    {
      name: "Memorial Day",
      month: memorialDay.month,
      day: memorialDay.day,
      duration: 5,
      type: "holiday",
      // US-only. Furniture/mattress + BBQ + auto
      industries: ["home", "automotive", "sports_outdoors", "food", "fashion"],
      countries: ["US"],
    },
    ...(perYear ? [
      {
        name: "Eid al-Adha",
        month: perYear.eidAlAdha.month,
        day: perYear.eidAlAdha.day,
        duration: 4,
        type: "cultural" as const,
        industries: ["fashion", "jewelry", "food", "home", "travel"],
        countries: MUSLIM_POPULATIONS,
      },
    ] : []),

    // ── JUNE ──
    {
      name: "Father's Day",
      month: fathersDay.month,
      day: fathersDay.day,
      duration: 7,
      type: "holiday",
      // NRF 2025: $24B - fashion #1, electronics, food, sports_outdoors, entertainment, gaming, personal_care
      industries: ["fashion", "electronics", "food", "sports_outdoors", "entertainment", "gaming", "personal_care"],
      countries: ["US", "GB", "CA", "IE", "FR", "DE"],
    },
    {
      name: "Pride Month",
      month: 6,
      day: 1,
      duration: 30,
      type: "cultural",
      // Authenticity-gated: use for brands with genuine commitment
      industries: ["fashion", "beauty", "nonprofit"],
      countries: ["US", "GB", "CA", "AU", "NZ", "IE", "DE", "FR", "NL", "BR", "MX"],
    },

    // ── JULY ──
    {
      name: "Independence Day",
      month: 7,
      day: 4,
      duration: 5,
      type: "holiday",
      industries: ["food", "sports_outdoors", "fashion", "home", "automotive"],
      countries: ["US"],
    },
    ...(perYear ? [
      {
        name: "Prime Day",
        month: perYear.primeDay.month,
        day: perYear.primeDay.day,
        duration: 4,
        type: "commercial" as const,
        // Amazon 2025: electronics #1, beauty/skincare/personal_care #2, home #3
        industries: ["electronics", "beauty", "skincare", "personal_care", "home", "tech", "health"],
        // Global Amazon markets
        countries: ["US", "GB", "CA", "AU", "DE", "FR", "IT", "ES", "JP", "IN", "MX", "BR"],
      },
    ] : []),

    // ── AUGUST ──
    {
      name: "Back to School",
      month: 7,
      day: 20,
      duration: 45,
      type: "season",
      // NRF 2025: $128B. Electronics #1 ($13.7B K-12), fashion, education, arts_crafts, tech, baby_kids
      industries: ["electronics", "fashion", "education", "arts_crafts", "tech", "baby_kids"],
      countries: ["US", "CA", "GB", "AU"],
    },

    // ── SEPTEMBER ──
    {
      name: "Labor Day",
      month: laborDay.month,
      day: laborDay.day,
      duration: 5,
      type: "holiday",
      industries: ["home", "automotive", "sports_outdoors", "fashion"],
      countries: ["US", "CA"],
    },

    // ── OCTOBER / NOVEMBER - Diwali + Halloween ──
    ...(perYear ? [
      {
        name: "Diwali",
        month: perYear.diwali.month,
        day: perYear.diwali.day,
        duration: 5,
        type: "cultural" as const,
        // India 2025: ₹6T retail - jewelry, electronics, fashion, home, food, beauty, automotive
        industries: ["jewelry", "electronics", "fashion", "home", "food", "beauty", "automotive"],
        countries: SOUTH_ASIAN,
      },
    ] : []),
    {
      name: "Halloween",
      month: 10,
      day: 31,
      duration: 14,
      type: "holiday",
      // NRF 2025: $13.1B - arts_crafts #1 (decor), fashion (costumes), food (candy), pet_care, baby_kids, home, entertainment
      industries: ["arts_crafts", "fashion", "food", "pet_care", "baby_kids", "home", "entertainment"],
      countries: ["US", "CA", "GB", "IE", "AU", "MX", "JP"],
    },
    {
      name: "Singles Day",
      month: 11,
      day: 11,
      duration: 3,
      type: "commercial",
      // Global 11.11 = $150B+. Electronics dominant, beauty fastest-growing
      industries: ["electronics", "beauty", "skincare", "fashion", "luxury", "home", "food"],
      countries: [...ASIA_PACIFIC, "GB", "US", "AE", "SA"],
    },
    {
      name: "Veterans Day",
      month: 11,
      day: 11,
      duration: 3,
      type: "holiday",
      // Commercial only - brands should use respectful messaging
      industries: ["home", "automotive", "fashion", "finance"],
      countries: ["US"],
    },
    {
      name: "Thanksgiving",
      month: thanksgiving.month,
      day: thanksgiving.day,
      duration: 2,
      type: "holiday",
      industries: ["food", "home"],
      countries: ["US", "CA"],
    },
    {
      name: "Black Friday",
      month: blackFriday.month,
      day: blackFriday.day,
      duration: 4,
      type: "event",
      // Essentially every category participates. Luxury opts out.
      industries: [
        "electronics", "home", "fashion", "gaming", "beauty", "skincare",
        "tech", "food", "sports_outdoors", "baby_kids", "pet_care",
        "health", "fitness", "personal_care", "jewelry", "automotive",
      ],
      // Globalized
    },
    {
      name: "Cyber Monday",
      month: cyberMonday.month,
      day: cyberMonday.day,
      duration: 2,
      type: "event",
      // Electronics/tech/gaming dominant on Cyber Monday
      industries: ["electronics", "tech", "gaming", "fashion", "beauty", "home", "toys"],
      // Globalized but tech-weighted
    },

    // ── DECEMBER ──
    ...(perYear ? [
      {
        name: "Hanukkah",
        month: perYear.hanukkahStart.month,
        day: perYear.hanukkahStart.day,
        duration: 8,
        type: "cultural" as const,
        // US 14% celebrate - baby_kids, books, fashion, food, arts_crafts
        industries: ["baby_kids", "books", "fashion", "food", "arts_crafts"],
        countries: ["US", "IL", "GB", "CA", "AU"],
      },
    ] : []),
    {
      name: "Christmas",
      month: 12,
      day: 25,
      duration: 7, // active runs Nov 15 - Dec 26 via the -21 day activeFrom buffer elsewhere
      type: "holiday",
      // Peak spend across most categories; excludes automotive/real_estate/finance (B2C retail only)
      industries: [
        "baby_kids", "fashion", "electronics", "jewelry", "food", "beauty",
        "skincare", "home", "travel", "gaming", "books", "luxury",
        "personal_care", "toys", "sports_outdoors", "pet_care",
      ],
      countries: WESTERN_CHRISTIAN,
    },
    {
      name: "Boxing Day",
      month: 12,
      day: 26,
      duration: 7,
      type: "commercial",
      // UK £3.6B 2025 - fashion #1, food, beauty, home
      industries: ["fashion", "food", "beauty", "home", "electronics"],
      countries: COMMONWEALTH_ENGLISH,
    },
    {
      name: "New Year's Eve",
      month: 12,
      day: 31,
      duration: 2,
      type: "holiday",
      industries: ["fashion", "beauty", "food", "entertainment"],
      // Global
    },
  ];

  return events;
}

// ─── Upcoming events, country-aware ────────────────────────────────────────

export interface HolidayEventWithDate extends HolidayEvent {
  startDate: number; // ms timestamp of the event day
}

/**
 * Returns upcoming events within `daysAhead` days, optionally filtered by country.
 *
 * @param daysAhead how many days forward to look (default 21)
 * @param countryCode ISO country code of the brand (e.g., "US"). If provided,
 *                    events with a `countries` list that doesn't include this
 *                    code are excluded. Events without `countries` are global.
 */
export function getUpcomingEvents(
  daysAhead: number = 21,
  countryCode?: string,
): HolidayEventWithDate[] {
  const now = new Date();
  const futureTime = now.getTime() + daysAhead * 24 * 60 * 60 * 1000;
  const currentYear = now.getFullYear();

  // Build events for this year + next year (handle year-end rollover)
  const allEvents: HolidayEventWithDate[] = [];
  for (const y of [currentYear, currentYear + 1]) {
    for (const event of getHolidayCalendar(y)) {
      const eventDate = new Date(y, event.month - 1, event.day);
      allEvents.push({ ...event, startDate: eventDate.getTime() });
    }
  }

  return allEvents
    .filter((event) => {
      // Within lookahead window AND not past
      if (event.startDate < now.getTime() || event.startDate > futureTime) return false;
      // Country scoping
      if (event.countries && countryCode && !event.countries.includes(countryCode)) return false;
      return true;
    })
    .sort((a, b) => a.startDate - b.startDate);
}

/**
 * Returns upcoming events that match a specific industry AND brand's country.
 * This is the filter the template generator should use.
 */
export function getUpcomingEventsForIndustry(
  industry: string,
  daysAhead: number = 21,
  countryCode?: string,
): HolidayEventWithDate[] {
  return getUpcomingEvents(daysAhead, countryCode).filter((event) =>
    event.industries.includes(industry)
  );
}

// ─── Currently active seasonal event (for UI banners, etc.) ────────────────

export function getActiveSeasonalEvent(countryCode?: string): HolidayEvent | null {
  const now = Date.now();
  const currentYear = new Date().getFullYear();

  for (const event of getHolidayCalendar(currentYear)) {
    if (event.countries && countryCode && !event.countries.includes(countryCode)) continue;
    const eventDate = new Date(currentYear, event.month - 1, event.day);
    const eventEnd = eventDate.getTime() + event.duration * 24 * 60 * 60 * 1000;
    if (now >= eventDate.getTime() && now <= eventEnd) return event;
  }

  return null;
}

export function getHolidayByName(name: string): HolidayEvent | undefined {
  const currentYear = new Date().getFullYear();
  return getHolidayCalendar(currentYear).find(
    (h) => h.name.toLowerCase() === name.toLowerCase()
  );
}
