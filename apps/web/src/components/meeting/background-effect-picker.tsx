import { useState } from "react";
import { ImageOff, Sparkles } from "lucide-react";
import { cn } from "@ossmeet/shared";
import { PopoverRoot, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PRESET_BACKGROUNDS, type BackgroundMode } from "@/lib/meeting/use-background-effect";

interface BackgroundEffectPickerProps {
  mode: BackgroundMode;
  imagePath: string | null;
  isProcessing: boolean;
  variant?: "dark" | "light";
  onSelectNone: () => void;
  onSelectBlur: () => void;
  onSelectImage: (path: string) => void;
}

export function BackgroundEffectPicker({
  mode,
  imagePath,
  isProcessing,
  variant = "dark",
  onSelectNone,
  onSelectBlur,
  onSelectImage,
}: BackgroundEffectPickerProps) {
  const isLight = variant === "light";

  return (
    <div className="w-64 p-3">
      <p className={cn("mb-2 text-xs font-medium", isLight ? "text-stone-500" : "text-white/60")}>Background</p>

      <div className="grid grid-cols-3 gap-2 max-h-72 overflow-y-auto overscroll-contain">
        {/* None */}
        <OptionTile
          selected={mode === "none"}
          disabled={isProcessing}
          onClick={onSelectNone}
          label="None"
          variant={variant}
        >
          <ImageOff className={cn("h-5 w-5", isLight ? "text-stone-500" : "text-white/50")} />
        </OptionTile>

        {/* Blur */}
        <OptionTile
          selected={mode === "blur"}
          disabled={isProcessing}
          onClick={onSelectBlur}
          label="Blur"
          variant={variant}
        >
          <Sparkles className={cn("h-5 w-5", isLight ? "text-stone-500" : "text-white/50")} />
        </OptionTile>

        {/* Preset images */}
        {PRESET_BACKGROUNDS.map((bg) => (
          <OptionTile
            key={bg}
            selected={mode === "image" && imagePath === bg}
            disabled={isProcessing}
            onClick={() => onSelectImage(bg)}
            variant={variant}
          >
            <img
              src={bg}
              alt=""
              className="h-full w-full rounded-lg object-cover"
              loading="lazy"
            />
          </OptionTile>
        ))}
      </div>
    </div>
  );
}

function OptionTile({
  selected,
  disabled,
  onClick,
  label,
  variant = "dark",
  children,
}: {
  selected: boolean;
  disabled: boolean;
  onClick: () => void;
  label?: string;
  variant?: "dark" | "light";
  children: React.ReactNode;
}) {
  const isLight = variant === "light";
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "relative flex aspect-video items-center justify-center overflow-hidden rounded-lg border-2 transition-all",
        selected
          ? "border-accent-500 ring-1 ring-accent-500/40"
          : isLight
            ? "border-stone-200 hover:border-stone-300"
            : "border-white/10 hover:border-white/30",
        isLight && "bg-stone-50",
        disabled && "pointer-events-none opacity-50",
      )}
    >
      {children}
      {label && (
        <span className={cn(
          "absolute inset-x-0 bottom-0 py-0.5 text-center text-2xs font-medium",
          isLight ? "bg-white/80 text-stone-700" : "bg-black/50 text-white"
        )}>
          {label}
        </span>
      )}
    </button>
  );
}

/**
 * Wrapper that renders the background effect button + popover for the TopControlBar.
 */
export function BackgroundEffectButton({
  mode,
  imagePath,
  isProcessing,
  onSelectNone,
  onSelectBlur,
  onSelectImage,
}: BackgroundEffectPickerProps) {
  const [open, setOpen] = useState(false);

  const button = (
    <button
      type="button"
      disabled={isProcessing}
      aria-label={mode === "none" ? "Add background effect" : "Change background effect"}
      title="Background effects"
      className={cn(
        "relative flex h-8 w-8 items-center justify-center rounded-xl transition-all duration-150",
        "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/30",
        isProcessing && "cursor-not-allowed opacity-40",
        mode !== "none"
          ? "bg-accent-600 text-white shadow-sm"
          : "text-stone-600 hover:bg-stone-300/70 hover:text-stone-900",
      )}
    >
      <Sparkles className="h-4 w-4" strokeWidth={mode !== "none" ? 2.5 : 1.75} />
    </button>
  );

  return (
    <div className="relative">
      <PopoverRoot open={open} onOpenChange={setOpen}>
        <PopoverTrigger render={button} />
        <PopoverContent
          side="top"
          className="rounded-xl bg-stone-900/95 shadow-2xl ring-1 ring-white/10 backdrop-blur-xl"
        >
          <BackgroundEffectPicker
            mode={mode}
            imagePath={imagePath}
            isProcessing={isProcessing}
            onSelectNone={() => { onSelectNone(); setOpen(false); }}
            onSelectBlur={() => { onSelectBlur(); setOpen(false); }}
            onSelectImage={(p) => { onSelectImage(p); setOpen(false); }}
          />
        </PopoverContent>
      </PopoverRoot>
    </div>
  );
}
