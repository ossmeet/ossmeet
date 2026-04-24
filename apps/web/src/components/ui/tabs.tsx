import { Tabs as BaseTabs } from "@base-ui/react/tabs";
import { cn } from "@ossmeet/shared";
import type { ReactNode } from "react";

const listVariants = {
  underline: "flex gap-1 border-b border-neutral-200",
  pill: "inline-flex gap-1 rounded-lg bg-neutral-100 p-1",
  enclosed: "flex gap-0 border-b border-neutral-200",
};

const tabVariants = {
  underline:
    "flex items-center gap-1.5 border-b-2 border-transparent px-4 py-2.5 text-sm font-medium text-neutral-500 transition-colors select-none hover:text-neutral-700 data-[active]:border-accent-600 data-[active]:text-accent-700",
  pill: "rounded-md px-3 py-1.5 text-sm font-medium text-neutral-500 transition-all select-none hover:text-neutral-700 data-[active]:bg-white data-[active]:text-neutral-900 data-[active]:shadow-sm",
  enclosed:
    "flex items-center gap-1.5 border-b-2 border-transparent rounded-t-lg px-4 py-2.5 text-sm font-medium text-neutral-500 transition-colors select-none hover:bg-neutral-50 hover:text-neutral-700 data-[active]:border-accent-600 data-[active]:text-accent-700 data-[active]:bg-accent-50/50",
};

interface TabsProps {
  defaultValue?: string;
  value?: string;
  onValueChange?: (value: string) => void;
  variant?: keyof typeof listVariants;
  children: ReactNode;
  className?: string;
}

export function Tabs({
  defaultValue,
  value,
  onValueChange,
  children,
  className,
}: TabsProps) {
  return (
    <BaseTabs.Root
      defaultValue={defaultValue}
      value={value}
      onValueChange={
        onValueChange
          ? (newValue: string | number | null) => {
              if (newValue !== null) {
                onValueChange(String(newValue));
              }
            }
          : undefined
      }
      className={className}
    >
      {children}
    </BaseTabs.Root>
  );
}

export function TabsList({
  variant = "underline",
  children,
  className,
}: {
  variant?: keyof typeof listVariants;
  children: ReactNode;
  className?: string;
}) {
  return (
    <BaseTabs.List className={cn(listVariants[variant], className)}>
      {children}
    </BaseTabs.List>
  );
}

export function TabsTrigger({
  value,
  variant = "underline",
  children,
  className,
}: {
  value: string;
  variant?: keyof typeof tabVariants;
  children: ReactNode;
  className?: string;
}) {
  return (
    <BaseTabs.Tab
      value={value}
      className={cn(tabVariants[variant], className)}
    >
      {children}
    </BaseTabs.Tab>
  );
}

export function TabsContent({
  value,
  children,
  className,
}: {
  value: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <BaseTabs.Panel value={value} className={cn("pt-6", className)}>
      {children}
    </BaseTabs.Panel>
  );
}

export function TabsIndicator({ className }: { className?: string }) {
  return (
    <BaseTabs.Indicator
      className={cn(
        "absolute bottom-0 left-0 h-0.5 w-[var(--active-tab-width)] translate-x-[var(--active-tab-left)] bg-accent-600 transition-all duration-200 ease-in-out",
        className
      )}
    />
  );
}
