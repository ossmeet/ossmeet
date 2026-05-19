import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SPEECH_LANGUAGE,
  LEGACY_SPOKEN_LANGUAGE_STORAGE_KEY,
  loadSavedSpokenLanguage,
  pickSpeechLanguage,
  saveSpokenLanguage,
  SPOKEN_LANGUAGE_STORAGE_KEY,
} from "./speech-languages";

function stubLocalStorage() {
  const store = new Map<string, string>();
  const localStorage = {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      store.delete(key);
    }),
  };

  vi.stubGlobal("window", { localStorage });
  return { localStorage, store };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("spoken language preference", () => {
  it("normalizes case and writes only the current storage key", () => {
    const { store } = stubLocalStorage();

    saveSpokenLanguage("bn-bd");

    expect(store.get(SPOKEN_LANGUAGE_STORAGE_KEY)).toBe("bn-BD");
    expect(store.has(LEGACY_SPOKEN_LANGUAGE_STORAGE_KEY)).toBe(false);
  });

  it("migrates away from the legacy key when re-saving", () => {
    const { store } = stubLocalStorage();
    store.set(LEGACY_SPOKEN_LANGUAGE_STORAGE_KEY, "hi-IN");

    saveSpokenLanguage("en-US");

    expect(store.get(SPOKEN_LANGUAGE_STORAGE_KEY)).toBe("en-US");
    expect(store.has(LEGACY_SPOKEN_LANGUAGE_STORAGE_KEY)).toBe(false);
  });

  it("loads the new key in preference to the legacy one", () => {
    const { store } = stubLocalStorage();
    store.set(LEGACY_SPOKEN_LANGUAGE_STORAGE_KEY, "hi-IN");
    store.set(SPOKEN_LANGUAGE_STORAGE_KEY, "bn-BD");

    expect(loadSavedSpokenLanguage()).toBe("bn-BD");
  });

  it("falls back to the legacy key when nothing is saved under the new one", () => {
    const { store } = stubLocalStorage();
    store.set(LEGACY_SPOKEN_LANGUAGE_STORAGE_KEY, "hi-IN");

    expect(loadSavedSpokenLanguage()).toBe("hi-IN");
  });
});

describe("pickSpeechLanguage", () => {
  it("returns the saved choice when present, ignoring everything else", () => {
    expect(
      pickSpeechLanguage({
        savedLanguage: "ja-JP",
        navigatorLanguage: "en-US",
        country: "IN",
      }),
    ).toBe("ja-JP");
  });

  it("does not return the saved choice when it is not a supported tag", () => {
    expect(
      pickSpeechLanguage({
        savedLanguage: "xx-YY",
        navigatorLanguage: "en-US",
        country: "US",
      }),
    ).toBe("en-US");
  });

  it("narrows navigator base language to the user's country when possible", () => {
    // Indian English speaker — must NOT default to Bangla just because IN
    // has Bangla as the alphabetically-first regional variant.
    expect(
      pickSpeechLanguage({
        navigatorLanguage: "en",
        country: "IN",
      }),
    ).toBe("en-IN");

    expect(
      pickSpeechLanguage({
        navigatorLanguage: "en-US",
        country: "ZA",
      }),
    ).toBe("en-ZA");

    expect(
      pickSpeechLanguage({
        navigatorLanguage: "es",
        country: "MX",
      }),
    ).toBe("es-MX");
  });

  it("uses the canonical variant for a base language when no country variant exists", () => {
    expect(pickSpeechLanguage({ navigatorLanguage: "en" })).toBe("en-US");
    expect(pickSpeechLanguage({ navigatorLanguage: "es" })).toBe("es-ES");
    expect(pickSpeechLanguage({ navigatorLanguage: "pt" })).toBe("pt-BR");
    expect(pickSpeechLanguage({ navigatorLanguage: "zh" })).toBe("cmn-Hans-CN");
    expect(pickSpeechLanguage({ navigatorLanguage: "bn" })).toBe("bn-BD");
  });

  it("ignores country narrowing for languages with no regional variant there", () => {
    // ja has no -IN variant; should fall through to the canonical Japanese.
    expect(
      pickSpeechLanguage({ navigatorLanguage: "ja", country: "IN" }),
    ).toBe("ja-JP");
  });

  it("falls back to the country-default when navigator gives nothing", () => {
    expect(pickSpeechLanguage({ country: "IN" })).toBe("hi-IN");
    expect(pickSpeechLanguage({ country: "BD" })).toBe("bn-BD");
    expect(pickSpeechLanguage({ country: "FR" })).toBe("fr-FR");
    expect(pickSpeechLanguage({ country: "JP" })).toBe("ja-JP");
  });

  it("falls back to en-US for unknown countries with no other hint", () => {
    expect(pickSpeechLanguage({ country: "ZZ" })).toBe(DEFAULT_SPEECH_LANGUAGE);
    expect(pickSpeechLanguage({})).toBe(DEFAULT_SPEECH_LANGUAGE);
  });

  it("handles full navigator tags like en_US (underscore form)", () => {
    expect(pickSpeechLanguage({ navigatorLanguage: "en_US" })).toBe("en-US");
  });

  it("treats blank strings as missing", () => {
    expect(
      pickSpeechLanguage({
        savedLanguage: "",
        navigatorLanguage: "",
        country: "",
      }),
    ).toBe(DEFAULT_SPEECH_LANGUAGE);
  });
});
