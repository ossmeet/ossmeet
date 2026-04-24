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
export const SPEECH_LANGUAGE_STORAGE_KEY = "ossmeet.caption.language.v1";

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

export function loadSavedSpeechLanguage(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return normalizeSpeechLanguageTag(window.localStorage.getItem(SPEECH_LANGUAGE_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function saveSpeechLanguage(language: string): void {
  if (typeof window === "undefined") return;
  const normalized = normalizeSpeechLanguageTag(language);
  if (!normalized) return;
  try {
    window.localStorage.setItem(SPEECH_LANGUAGE_STORAGE_KEY, normalized);
  } catch {
    // localStorage may be unavailable in private contexts.
  }
}

export function pickSpeechLanguage({
  savedLanguage,
  navigatorLanguage,
  country,
}: {
  savedLanguage?: string | null;
  navigatorLanguage?: string | null;
  country?: string | null;
}): string {
  return (
    normalizeSpeechLanguageTag(savedLanguage) ??
    languageOptionsForCountry(country)[0]?.tag ??
    normalizeSpeechLanguageTag(navigatorLanguage) ??
    DEFAULT_SPEECH_LANGUAGE
  );
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
