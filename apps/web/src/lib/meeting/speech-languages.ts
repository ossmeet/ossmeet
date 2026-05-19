export interface SpeechLanguageOption {
  label: string;
  tag: string;
  regionLabel?: string;
  englishLabel?: string;
  englishRegionLabel?: string;
  aliases?: string[];
}

const RAW_GOOGLE_SPEECH_LANGUAGES: Array<{
  label: string;
  variants: Array<[tag: string, regionLabel?: string]>;
}> = [
  { label: "Afrikaans", variants: [["af-ZA"]] },
  { label: "አማርኛ", variants: [["am-ET"]] },
  { label: "Azərbaycanca", variants: [["az-AZ"]] },
  { label: "বাংলা", variants: [["bn-BD", "বাংলাদেশ"], ["bn-IN", "ভারত"]] },
  { label: "Bahasa Indonesia", variants: [["id-ID"]] },
  { label: "Bahasa Melayu", variants: [["ms-MY"]] },
  { label: "Català", variants: [["ca-ES"]] },
  { label: "Čeština", variants: [["cs-CZ"]] },
  { label: "Dansk", variants: [["da-DK"]] },
  { label: "Deutsch", variants: [["de-DE"]] },
  {
    label: "English",
    variants: [
      ["en-AU", "Australia"], ["en-CA", "Canada"], ["en-IN", "India"],
      ["en-KE", "Kenya"], ["en-TZ", "Tanzania"], ["en-GH", "Ghana"],
      ["en-NZ", "New Zealand"], ["en-NG", "Nigeria"], ["en-ZA", "South Africa"],
      ["en-PH", "Philippines"], ["en-GB", "United Kingdom"], ["en-US", "United States"],
    ],
  },
  {
    label: "Español",
    variants: [
      ["es-AR", "Argentina"], ["es-BO", "Bolivia"], ["es-CL", "Chile"],
      ["es-CO", "Colombia"], ["es-CR", "Costa Rica"], ["es-EC", "Ecuador"],
      ["es-SV", "El Salvador"], ["es-ES", "España"], ["es-US", "Estados Unidos"],
      ["es-GT", "Guatemala"], ["es-HN", "Honduras"], ["es-MX", "México"],
      ["es-NI", "Nicaragua"], ["es-PA", "Panamá"], ["es-PY", "Paraguay"],
      ["es-PE", "Perú"], ["es-PR", "Puerto Rico"], ["es-DO", "República Dominicana"],
      ["es-UY", "Uruguay"], ["es-VE", "Venezuela"],
    ],
  },
  { label: "Euskara", variants: [["eu-ES"]] },
  { label: "Filipino", variants: [["fil-PH"]] },
  { label: "Français", variants: [["fr-FR"]] },
  { label: "Basa Jawa", variants: [["jv-ID"]] },
  { label: "Galego", variants: [["gl-ES"]] },
  { label: "ગુજરાતી", variants: [["gu-IN"]] },
  { label: "Hrvatski", variants: [["hr-HR"]] },
  { label: "IsiZulu", variants: [["zu-ZA"]] },
  { label: "Íslenska", variants: [["is-IS"]] },
  { label: "Italiano", variants: [["it-IT", "Italia"], ["it-CH", "Svizzera"]] },
  { label: "ಕನ್ನಡ", variants: [["kn-IN"]] },
  { label: "ភាសាខ្មែរ", variants: [["km-KH"]] },
  { label: "Latviešu", variants: [["lv-LV"]] },
  { label: "Lietuvių", variants: [["lt-LT"]] },
  { label: "മലയാളം", variants: [["ml-IN"]] },
  { label: "मराठी", variants: [["mr-IN"]] },
  { label: "Magyar", variants: [["hu-HU"]] },
  { label: "ລາວ", variants: [["lo-LA"]] },
  { label: "Nederlands", variants: [["nl-NL"]] },
  { label: "नेपाली भाषा", variants: [["ne-NP"]] },
  { label: "Norsk bokmål", variants: [["nb-NO"]] },
  { label: "Polski", variants: [["pl-PL"]] },
  { label: "Português", variants: [["pt-BR", "Brasil"], ["pt-PT", "Portugal"]] },
  { label: "Română", variants: [["ro-RO"]] },
  { label: "සිංහල", variants: [["si-LK"]] },
  { label: "Slovenščina", variants: [["sl-SI"]] },
  { label: "Basa Sunda", variants: [["su-ID"]] },
  { label: "Slovenčina", variants: [["sk-SK"]] },
  { label: "Suomi", variants: [["fi-FI"]] },
  { label: "Svenska", variants: [["sv-SE"]] },
  { label: "Kiswahili", variants: [["sw-TZ", "Tanzania"], ["sw-KE", "Kenya"]] },
  { label: "ქართული", variants: [["ka-GE"]] },
  { label: "Հայերեն", variants: [["hy-AM"]] },
  {
    label: "தமிழ்",
    variants: [["ta-IN", "இந்தியா"], ["ta-SG", "சிங்கப்பூர்"], ["ta-LK", "இலங்கை"], ["ta-MY", "மலேசியா"]],
  },
  { label: "తెలుగు", variants: [["te-IN"]] },
  { label: "Tiếng Việt", variants: [["vi-VN"]] },
  { label: "Türkçe", variants: [["tr-TR"]] },
  { label: "اُردُو", variants: [["ur-PK", "پاکستان"], ["ur-IN", "بھارت"]] },
  { label: "Ελληνικά", variants: [["el-GR"]] },
  { label: "български", variants: [["bg-BG"]] },
  { label: "Русский", variants: [["ru-RU"]] },
  { label: "Српски", variants: [["sr-RS"]] },
  { label: "Українська", variants: [["uk-UA"]] },
  { label: "한국어", variants: [["ko-KR"]] },
  {
    label: "中文",
    variants: [
      ["cmn-Hans-CN", "普通话 (中国大陆)"], ["cmn-Hans-HK", "普通话 (香港)"],
      ["cmn-Hant-TW", "中文 (台灣)"], ["yue-Hant-HK", "粵語 (香港)"],
    ],
  },
  { label: "日本語", variants: [["ja-JP"]] },
  { label: "हिन्दी", variants: [["hi-IN"]] },
  { label: "ภาษาไทย", variants: [["th-TH"]] },
];

const LANGUAGE_METADATA: Record<string, Pick<SpeechLanguageOption, "englishLabel" | "englishRegionLabel" | "aliases">> = {
  "bn-BD": { englishLabel: "Bangla", englishRegionLabel: "Bangladesh", aliases: ["bangla", "bengali", "bangladesh"] },
  "bn-IN": { englishLabel: "Bangla", englishRegionLabel: "India", aliases: ["bangla", "bengali", "india"] },
  "am-ET": { englishLabel: "Amharic", englishRegionLabel: "Ethiopia", aliases: ["amharic"] },
  "gu-IN": { englishLabel: "Gujarati", englishRegionLabel: "India", aliases: ["gujarati"] },
  "hi-IN": { englishLabel: "Hindi", englishRegionLabel: "India", aliases: ["hindi"] },
  "hy-AM": { englishLabel: "Armenian", englishRegionLabel: "Armenia", aliases: ["armenian"] },
  "ja-JP": { englishLabel: "Japanese", englishRegionLabel: "Japan", aliases: ["japanese"] },
  "ka-GE": { englishLabel: "Georgian", englishRegionLabel: "Georgia", aliases: ["georgian"] },
  "km-KH": { englishLabel: "Khmer", englishRegionLabel: "Cambodia", aliases: ["khmer", "cambodian"] },
  "kn-IN": { englishLabel: "Kannada", englishRegionLabel: "India", aliases: ["kannada"] },
  "ko-KR": { englishLabel: "Korean", englishRegionLabel: "South Korea", aliases: ["korean"] },
  "lo-LA": { englishLabel: "Lao", englishRegionLabel: "Laos", aliases: ["lao"] },
  "ml-IN": { englishLabel: "Malayalam", englishRegionLabel: "India", aliases: ["malayalam"] },
  "mr-IN": { englishLabel: "Marathi", englishRegionLabel: "India", aliases: ["marathi"] },
  "ne-NP": { englishLabel: "Nepali", englishRegionLabel: "Nepal", aliases: ["nepali"] },
  "si-LK": { englishLabel: "Sinhala", englishRegionLabel: "Sri Lanka", aliases: ["sinhala", "sinhalese"] },
  "ta-IN": { englishLabel: "Tamil", englishRegionLabel: "India", aliases: ["tamil"] },
  "ta-SG": { englishLabel: "Tamil", englishRegionLabel: "Singapore", aliases: ["tamil"] },
  "ta-LK": { englishLabel: "Tamil", englishRegionLabel: "Sri Lanka", aliases: ["tamil"] },
  "ta-MY": { englishLabel: "Tamil", englishRegionLabel: "Malaysia", aliases: ["tamil"] },
  "te-IN": { englishLabel: "Telugu", englishRegionLabel: "India", aliases: ["telugu"] },
  "th-TH": { englishLabel: "Thai", englishRegionLabel: "Thailand", aliases: ["thai"] },
  "ur-PK": { englishLabel: "Urdu", englishRegionLabel: "Pakistan", aliases: ["urdu"] },
  "ur-IN": { englishLabel: "Urdu", englishRegionLabel: "India", aliases: ["urdu"] },
  "yue-Hant-HK": { englishLabel: "Cantonese", englishRegionLabel: "Hong Kong", aliases: ["cantonese", "chinese"] },
  "cmn-Hans-CN": { englishLabel: "Mandarin", englishRegionLabel: "China", aliases: ["mandarin", "chinese", "simplified chinese"] },
  "cmn-Hans-HK": { englishLabel: "Mandarin", englishRegionLabel: "Hong Kong", aliases: ["mandarin", "chinese"] },
  "cmn-Hant-TW": { englishLabel: "Chinese", englishRegionLabel: "Taiwan", aliases: ["traditional chinese", "chinese", "taiwanese mandarin"] },
  "bg-BG": { englishLabel: "Bulgarian", englishRegionLabel: "Bulgaria", aliases: ["bulgarian"] },
  "el-GR": { englishLabel: "Greek", englishRegionLabel: "Greece", aliases: ["greek"] },
  "ru-RU": { englishLabel: "Russian", englishRegionLabel: "Russia", aliases: ["russian"] },
  "sr-RS": { englishLabel: "Serbian", englishRegionLabel: "Serbia", aliases: ["serbian"] },
  "uk-UA": { englishLabel: "Ukrainian", englishRegionLabel: "Ukraine", aliases: ["ukrainian"] },
};

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function collatorCompare(a: SpeechLanguageOption, b: SpeechLanguageOption): number {
  const aLabel = a.englishLabel ?? a.label;
  const bLabel = b.englishLabel ?? b.label;
  const aRegion = a.englishRegionLabel ?? a.regionLabel ?? "";
  const bRegion = b.englishRegionLabel ?? b.regionLabel ?? "";
  return aLabel.localeCompare(bLabel, undefined, { sensitivity: "base" }) ||
    aRegion.localeCompare(bRegion, undefined, { sensitivity: "base" }) ||
    a.tag.localeCompare(b.tag);
}

export const SPEECH_LANGUAGE_OPTIONS: SpeechLanguageOption[] =
  RAW_GOOGLE_SPEECH_LANGUAGES.flatMap(({ label, variants }) =>
    variants.map(([tag, regionLabel]) => ({
      label,
      tag,
      regionLabel,
      ...(LANGUAGE_METADATA[tag] ?? {}),
    }))
  ).sort(collatorCompare);

export const DEFAULT_SPEECH_LANGUAGE = "en-US";
export const SPOKEN_LANGUAGE_STORAGE_KEY = "ossmeet.spoken-language.v1";
/** @deprecated Older storage key. Read for back-compat; never written. */
export const LEGACY_SPOKEN_LANGUAGE_STORAGE_KEY = "ossmeet.caption.language.v1";

/**
 * Canonical variant to pick when only the base language code is known
 * (e.g., navigator says "en" or "es" with no region). Without this map
 * we fall back to alphabetical order, which gives surprising defaults
 * like en-AU or es-AR.
 */
const NAVIGATOR_BASE_DEFAULT: Record<string, string> = {
  en: "en-US",
  es: "es-ES",
  pt: "pt-BR",
  fr: "fr-FR",
  de: "de-DE",
  it: "it-IT",
  zh: "cmn-Hans-CN",
  cmn: "cmn-Hans-CN",
  yue: "yue-Hant-HK",
  bn: "bn-BD",
  ta: "ta-IN",
  ur: "ur-PK",
  sw: "sw-KE",
};

/**
 * Default spoken language for a given country code when navigator gives no
 * usable hint. Only listed countries with an unambiguous dominant language
 * appear here; others fall through to DEFAULT_SPEECH_LANGUAGE.
 */
const COUNTRY_DEFAULT_LANGUAGE: Record<string, string> = {
  // English-majority
  US: "en-US", GB: "en-GB", IE: "en-GB", AU: "en-AU", CA: "en-CA",
  NZ: "en-NZ", ZA: "en-ZA", PH: "en-PH", NG: "en-NG", GH: "en-GH",
  KE: "en-KE", SG: "en-US",
  // South Asia
  IN: "hi-IN", BD: "bn-BD", PK: "ur-PK", LK: "si-LK", NP: "ne-NP",
  // East / Southeast Asia
  CN: "cmn-Hans-CN", HK: "yue-Hant-HK", MO: "yue-Hant-HK", TW: "cmn-Hant-TW",
  JP: "ja-JP", KR: "ko-KR", VN: "vi-VN", TH: "th-TH", MY: "ms-MY",
  ID: "id-ID", KH: "km-KH", LA: "lo-LA",
  // Latin America Spanish + Brazil
  MX: "es-MX", AR: "es-AR", CL: "es-CL", CO: "es-CO", PE: "es-PE",
  VE: "es-VE", EC: "es-EC", BO: "es-BO", PY: "es-PY", UY: "es-UY",
  CR: "es-CR", PA: "es-PA", GT: "es-GT", HN: "es-HN", SV: "es-SV",
  NI: "es-NI", DO: "es-DO", PR: "es-PR", ES: "es-ES", BR: "pt-BR", PT: "pt-PT",
  // Europe
  FR: "fr-FR", DE: "de-DE", IT: "it-IT", NL: "nl-NL", PL: "pl-PL",
  RU: "ru-RU", UA: "uk-UA", CZ: "cs-CZ", SK: "sk-SK", HU: "hu-HU",
  RO: "ro-RO", BG: "bg-BG", GR: "el-GR", HR: "hr-HR", SI: "sl-SI",
  RS: "sr-RS", SE: "sv-SE", NO: "nb-NO", DK: "da-DK", FI: "fi-FI",
  IS: "is-IS", TR: "tr-TR",
  // Caucasus / Africa
  AM: "hy-AM", GE: "ka-GE", AZ: "az-AZ", ET: "am-ET", TZ: "sw-TZ",
};

export function speechLanguageDisplayName(option: SpeechLanguageOption): string {
  const label = option.englishLabel && option.englishLabel !== option.label
    ? `${option.englishLabel} (${option.label})`
    : option.englishLabel ?? option.label;
  const region = option.englishRegionLabel ?? option.regionLabel ?? option.tag;
  return `${label} - ${region}`;
}

export function speechLanguageSearchKey(option: SpeechLanguageOption): string {
  return normalizeSearchText(
    [
      option.label,
      option.englishLabel,
      option.regionLabel,
      option.englishRegionLabel,
      option.tag,
      ...(option.aliases ?? []),
    ]
      .filter(Boolean)
      .join(" ")
  );
}

export function speechLanguageMatchesQuery(option: SpeechLanguageOption, query: string): boolean {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return true;
  return speechLanguageSearchKey(option).includes(normalizedQuery);
}

export function normalizeSpeechLanguageTag(tag: string | null | undefined): string | null {
  if (!tag) return null;
  const exact = SPEECH_LANGUAGE_OPTIONS.find((option) => option.tag === tag);
  if (exact) return exact.tag;

  const normalized = tag.toLowerCase();
  const caseInsensitive = SPEECH_LANGUAGE_OPTIONS.find(
    (option) => option.tag.toLowerCase() === normalized
  );
  if (caseInsensitive) return caseInsensitive.tag;

  const baseLanguage = normalized.split("-")[0];
  return SPEECH_LANGUAGE_OPTIONS.find(
    (option) => option.tag.toLowerCase().split("-")[0] === baseLanguage
  )?.tag ?? null;
}

export function loadSavedSpokenLanguage(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return normalizeSpeechLanguageTag(
      window.localStorage.getItem(SPOKEN_LANGUAGE_STORAGE_KEY) ??
        window.localStorage.getItem(LEGACY_SPOKEN_LANGUAGE_STORAGE_KEY)
    );
  } catch {
    return null;
  }
}

export function saveSpokenLanguage(language: string): void {
  if (typeof window === "undefined") return;
  const normalized = normalizeSpeechLanguageTag(language);
  if (!normalized) return;
  try {
    window.localStorage.setItem(SPOKEN_LANGUAGE_STORAGE_KEY, normalized);
    // Migrate away from the legacy key so it doesn't shadow updates later.
    window.localStorage.removeItem(LEGACY_SPOKEN_LANGUAGE_STORAGE_KEY);
  } catch {
    // localStorage may be unavailable in private contexts.
  }
}

function baseOf(tag: string): string {
  return tag.toLowerCase().split(/[-_]/)[0] ?? "";
}

/**
 * Pick a sensible default spoken language for the user.
 *
 * Priority:
 *   1. Saved preference (an explicit user choice always wins).
 *   2. Navigator's language, narrowed to the user's country if a matching
 *      regional variant exists (e.g., navigator=en, country=IN -> en-IN).
 *   3. The canonical variant for the navigator's base language
 *      (e.g., navigator=es -> es-ES, not es-AR by alphabet).
 *   4. The dominant language for the user's country (e.g., country=IN
 *      with no navigator hint -> hi-IN, not bn-IN by alphabet).
 *   5. en-US.
 */
export function pickSpeechLanguage({
  savedLanguage,
  navigatorLanguage,
  country,
}: {
  savedLanguage?: string | null;
  navigatorLanguage?: string | null;
  country?: string | null;
}): string {
  const saved = normalizeSpeechLanguageTag(savedLanguage);
  if (saved) return saved;

  const region = country?.trim().toUpperCase() || null;
  const navBase = navigatorLanguage ? baseOf(navigatorLanguage) : null;

  if (navBase) {
    // Narrow to the user's region when we have an exact <base>-<region> tag.
    if (region) {
      const regional = SPEECH_LANGUAGE_OPTIONS.find(
        (option) =>
          baseOf(option.tag) === navBase &&
          option.tag.toUpperCase().endsWith(`-${region}`),
      );
      if (regional) return regional.tag;
    }

    // Otherwise pick the canonical variant for that base language.
    const canonical = NAVIGATOR_BASE_DEFAULT[navBase];
    if (canonical) return canonical;

    // Last resort: try the full navigator tag, then any variant of the base.
    const fullMatch = normalizeSpeechLanguageTag(navigatorLanguage);
    if (fullMatch) return fullMatch;
  }

  if (region && COUNTRY_DEFAULT_LANGUAGE[region]) {
    return COUNTRY_DEFAULT_LANGUAGE[region];
  }

  return DEFAULT_SPEECH_LANGUAGE;
}

export function languageOptionsForCountry(country: string | null | undefined): SpeechLanguageOption[] {
  const region = country?.trim().toUpperCase();
  if (!region) return [];
  return SPEECH_LANGUAGE_OPTIONS
    .filter((option) => option.tag.toUpperCase().endsWith(`-${region}`))
    .sort(collatorCompare);
}

export function orderSpeechLanguagesForCountry(country: string | null | undefined): SpeechLanguageOption[] {
  const regional = languageOptionsForCountry(country);
  if (regional.length === 0) return SPEECH_LANGUAGE_OPTIONS;

  const regionalTags = new Set(regional.map((option) => option.tag));
  const priorityLabels = new Set(regional.map((option) => option.englishLabel ?? option.label));
  const siblingVariants = SPEECH_LANGUAGE_OPTIONS.filter(
    (option) =>
      !regionalTags.has(option.tag) &&
      priorityLabels.has(option.englishLabel ?? option.label)
  );
  const siblingTags = new Set(siblingVariants.map((option) => option.tag));

  return [
    ...regional,
    ...siblingVariants,
    ...SPEECH_LANGUAGE_OPTIONS.filter(
      (option) => !regionalTags.has(option.tag) && !siblingTags.has(option.tag)
    ),
  ];
}
