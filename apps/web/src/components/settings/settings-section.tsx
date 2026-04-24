import * as React from "react";

export function SettingsSection({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ElementType;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={title.toLowerCase().replace(/\s+/g, '-')} className="bg-white rounded-[2rem] ring-1 ring-black/5 shadow-[0_8px_30px_-4px_rgba(0,0,0,0.02)] p-6 md:p-8 scroll-mt-24">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-stone-100 to-stone-200/50">
          <Icon size={18} className="text-stone-700" />
        </div>
        <h2 className="text-lg font-bold text-stone-900">{title}</h2>
      </div>
      <div>
        {children}
      </div>
    </section>
  );
}
