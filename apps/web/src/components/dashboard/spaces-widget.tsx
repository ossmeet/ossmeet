import { Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { mySpacesQueryOptions } from "@/queries/spaces";
import { Globe, ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { getMySpaces } from "@/server/spaces";

const roleBadgeVariant = {
  owner: "primary" as const,
  admin: "warning" as const,
  member: "default" as const,
};

type DashboardSpace = Awaited<ReturnType<typeof getMySpaces>>["spaces"][number];

export function SpacesWidget() {
  const { data } = useSuspenseQuery(mySpacesQueryOptions());
  const spaces: DashboardSpace[] = data.spaces.slice(0, 4);

  if (spaces.length === 0) return null;

  return (
    <section className="h-full">
      {/* Simple header */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-medium text-stone-500 uppercase tracking-wide">
          Your Spaces
        </h2>
        <Link
          to="/spaces"
          className="text-xs text-amber-600 hover:text-amber-700"
        >
          View all →
        </Link>
      </div>

      {/* Connected card container */}
      <div className="bento-card p-1 h-[calc(100%-2.5rem)]">
        {/* Subtle gradient accent at top - amber for spaces */}
        <div className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-amber-500/40 via-amber-400/50 to-amber-500/40" />

        <div className="divide-y divide-stone-100">
          {spaces.map((space: DashboardSpace, i: number) => (
            <Link
              key={space.id}
              to="/spaces/$spaceId"
              params={{ spaceId: space.id }}
              className="group flex items-center gap-3 p-4 transition-all duration-200 hover:bg-stone-50/80 first:rounded-t-xl last:rounded-b-xl animate-fade-in-up"
              style={{ animationDelay: `${i * 50 + 200}ms` }}
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-amber-50 to-amber-100/50 group-hover:from-amber-100 group-hover:to-amber-200/50 transition-colors">
                <Globe size={18} className="text-amber-600" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-semibold text-stone-800 group-hover:text-amber-700 transition-colors">
                    {space.name}
                  </p>
                  <Badge
                    size="sm"
                    variant={roleBadgeVariant[space.role]}
                  >
                    {space.role}
                  </Badge>
                </div>
                {space.description && (
                  <p className="mt-0.5 truncate text-xs text-stone-500">
                    {space.description}
                  </p>
                )}
              </div>
              <ArrowRight
                size={16}
                className="shrink-0 text-stone-400 transition-transform group-hover:translate-x-0.5 group-hover:text-amber-600"
              />
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
