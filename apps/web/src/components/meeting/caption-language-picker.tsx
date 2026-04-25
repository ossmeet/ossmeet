import * as React from "react";
import { Search, Check } from "lucide-react";
import { cn } from "@ossmeet/shared";
import {
  orderSpeechLanguagesForCountry,
  speechLanguageDisplayName,
  speechLanguageMatchesQuery,
  type SpeechLanguageOption,
} from "@/lib/meeting/speech-languages";

interface CaptionLanguagePickerProps {
  country?: string | null;
  selectedLanguage: string;
  onSelectLanguage: (language: string) => void;
  className?: string;
  autoFocusSearch?: boolean;
  variant?: "dark" | "light";
}

export function CaptionLanguagePicker({
  country,
  selectedLanguage,
  onSelectLanguage,
  className,
  autoFocusSearch = false,
  variant = "dark",
}: CaptionLanguagePickerProps) {
  const isLight = variant === "light";
  const [query, setQuery] = React.useState("");
  const searchInputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (!autoFocusSearch) return;
    const frame = window.requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [autoFocusSearch]);

  const options = React.useMemo(() => {
    const ordered = orderSpeechLanguagesForCountry(country);
    const filtered = query.trim()
      ? ordered.filter((option) => speechLanguageMatchesQuery(option, query))
      : ordered;

    const selected = ordered.find((option) => option.tag === selectedLanguage);
    if (selected && !filtered.some((option) => option.tag === selected.tag)) {
      return [selected, ...filtered];
    }
    return filtered;
  }, [country, query, selectedLanguage]);

  return (
    <div className={cn("space-y-2", className)}>
      <div className={cn(
        "flex items-center gap-2 rounded-lg border px-3 py-2",
        isLight
          ? "border-stone-200 bg-white"
          : "border-white/10 bg-white/5"
      )}>
        <Search className={cn("h-4 w-4", isLight ? "text-stone-500" : "text-white/45")} />
        <input
          ref={searchInputRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search languages"
          className={cn(
            "w-full bg-transparent text-sm outline-hidden",
            isLight
              ? "text-stone-900 placeholder-stone-500"
              : "text-white placeholder-white/35"
          )}
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      <div
        role="listbox"
        aria-label="Languages"
        className={cn(
          "max-h-72 overflow-y-auto rounded-lg border p-1 [scrollbar-width:thin]",
          isLight
            ? "border-stone-200 bg-white"
            : "border-white/10 bg-white/5"
        )}
      >
        {options.map((option: SpeechLanguageOption) => {
          const active = option.tag === selectedLanguage;
          return (
            <button
              key={option.tag}
              type="button"
              role="option"
              aria-selected={active}
              onClick={() => onSelectLanguage(option.tag)}
              className={cn(
                "flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors",
                active
                  ? isLight
                    ? "bg-teal-50 text-stone-950 ring-1 ring-teal-200"
                    : "bg-accent-500/20 text-white ring-1 ring-accent-500/40"
                  : isLight
                    ? "text-stone-800 hover:bg-stone-100 hover:text-stone-950"
                    : "text-white/80 hover:bg-white/8 hover:text-white"
              )}
            >
              <span className="min-w-0 truncate">{speechLanguageDisplayName(option)}</span>
              <span className="flex shrink-0 items-center gap-2">
                {active && <Check className={cn("h-4 w-4", isLight ? "text-teal-700" : "text-primary-300")} />}
                <span className={cn("font-mono text-2xs", isLight ? "text-stone-500" : "text-white/35")}>{option.tag}</span>
              </span>
            </button>
          );
        })}
        {options.length === 0 && (
          <div className={cn("px-3 py-2 text-sm", isLight ? "text-stone-600" : "text-white/45")}>
            No matching language
          </div>
        )}
      </div>
    </div>
  );
}
