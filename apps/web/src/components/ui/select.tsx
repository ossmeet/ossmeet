import { Select as BaseSelect } from "@base-ui/react/select";
import { Check, ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";
import { cn } from "@ossmeet/shared";

interface SelectOption {
  label: string;
  value: string;
  disabled?: boolean;
}

interface SelectProps {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
  label?: string;
  options: SelectOption[];
  className?: string;
}

export function Select({
  value,
  defaultValue,
  onValueChange,
  placeholder = "Select…",
  disabled,
  label,
  options,
  className,
}: SelectProps) {
  return (
    <BaseSelect.Root
      value={value}
      defaultValue={defaultValue}
      onValueChange={onValueChange}
      disabled={disabled}
      items={options}
    >
      {label && (
        <BaseSelect.Label className="mb-1.5 block text-sm font-medium text-neutral-700">
          {label}
        </BaseSelect.Label>
      )}
      <BaseSelect.Trigger
        className={cn(
          "flex h-10 w-full items-center justify-between gap-2 rounded-lg border border-neutral-300 bg-white px-3 text-sm text-neutral-900 transition-all duration-150 select-none",
          "hover:border-neutral-400 focus-visible:outline-hidden focus-visible:border-accent-400 focus-visible:ring-2 focus-visible:ring-accent-500/20",
          "data-[popup-open]:border-accent-400 data-[popup-open]:ring-2 data-[popup-open]:ring-accent-500/20",
          "disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-neutral-50",
          className
        )}
      >
        <BaseSelect.Value
          className="data-[placeholder]:text-neutral-400"
          placeholder={placeholder}
        />
        <BaseSelect.Icon className="shrink-0 text-neutral-400">
          <ChevronsUpDown className="h-4 w-4" />
        </BaseSelect.Icon>
      </BaseSelect.Trigger>

      <BaseSelect.Portal>
        <BaseSelect.Positioner sideOffset={6} className="outline-hidden z-50">
          <BaseSelect.Popup
            className={cn(
              "min-w-[var(--anchor-width)] rounded-xl border border-neutral-200 bg-white py-1 shadow-lg",
              "origin-[var(--transform-origin)] transition-[transform,scale,opacity] duration-150",
              "data-[starting-style]:scale-95 data-[starting-style]:opacity-0",
              "data-[ending-style]:scale-95 data-[ending-style]:opacity-0"
            )}
          >
            <BaseSelect.ScrollUpArrow className="flex h-5 w-full cursor-default items-center justify-center text-neutral-400">
              <ChevronUp className="h-3 w-3" />
            </BaseSelect.ScrollUpArrow>
            <BaseSelect.List className="max-h-[var(--available-height)] overflow-y-auto py-1 scroll-py-1">
              {options.map(({ label: optLabel, value: optValue, disabled: optDisabled }) => (
                <BaseSelect.Item
                  key={optValue}
                  value={optValue}
                  disabled={optDisabled}
                  className={cn(
                    "grid cursor-default grid-cols-[1rem_1fr] items-center gap-2 px-3 py-2 text-sm text-neutral-700 select-none outline-hidden",
                    "data-[highlighted]:bg-accent-50 data-[highlighted]:text-accent-700",
                    "data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50"
                  )}
                >
                  <BaseSelect.ItemIndicator className="col-start-1 flex items-center justify-center">
                    <Check className="h-3.5 w-3.5 text-accent-600" />
                  </BaseSelect.ItemIndicator>
                  <BaseSelect.ItemText className="col-start-2">{optLabel}</BaseSelect.ItemText>
                </BaseSelect.Item>
              ))}
            </BaseSelect.List>
            <BaseSelect.ScrollDownArrow className="flex h-5 w-full cursor-default items-center justify-center text-neutral-400">
              <ChevronDown className="h-3 w-3" />
            </BaseSelect.ScrollDownArrow>
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
}

// Composable sub-exports for advanced use cases
export const SelectRoot = BaseSelect.Root;
export const SelectTrigger = BaseSelect.Trigger;
export const SelectValue = BaseSelect.Value;
export const SelectIcon = BaseSelect.Icon;
export const SelectPortal = BaseSelect.Portal;
export const SelectPositioner = BaseSelect.Positioner;
export const SelectPopup = BaseSelect.Popup;
export const SelectList = BaseSelect.List;
export const SelectItem = BaseSelect.Item;
export const SelectItemIndicator = BaseSelect.ItemIndicator;
export const SelectItemText = BaseSelect.ItemText;
export const SelectLabel = BaseSelect.Label;
export type { SelectOption };
