import { Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Link2, Copy, ExternalLink, Clock } from "lucide-react";
import { myMeetingLinksQueryOptions } from "@/queries/meetings";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import type { getMyMeetingLinks } from "@/server/meetings/dashboard";

type Room = Awaited<ReturnType<typeof getMyMeetingLinks>>["links"][number];

function formatLastUsed(date: string | null): string {
  if (!date) return "Never used";
  const d = new Date(date);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (days === 0) {
    const hours = Math.floor(diff / (1000 * 60 * 60));
    if (hours === 0) {
      const minutes = Math.floor(diff / (1000 * 60));
      return minutes < 1 ? "Just now" : `${minutes}m ago`;
    }
    return `${hours}h ago`;
  }
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function PermanentRooms() {
  const { data } = useSuspenseQuery(myMeetingLinksQueryOptions());
  const links: Room[] = data?.links ?? [];
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const copyLink = async (code: string, id: string) => {
    const url = `${window.location.origin}/${code}`;
    await navigator.clipboard.writeText(url);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  if (links.length === 0) {
    return null; // Don't show section if no permanent rooms
  }

  return (
    <section>
      <div className="flex items-center gap-2 mb-4">
        <div className="h-8 w-1 rounded-full bg-gradient-to-b from-amber-500 to-amber-600" />
        <h2 className="text-base font-semibold text-stone-800">Your Permanent Rooms</h2>
        <span className="ml-2 text-xs font-medium text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
          {links.length}
        </span>
      </div>

      <div className="rounded-2xl border border-stone-200/80 bg-white/80 backdrop-blur-sm p-1 shadow-soft overflow-hidden">
        <div className="divide-y divide-stone-100">
          {links.map((link: Room) => (
            <div
              key={link.id}
              className="group flex items-center gap-3 p-4 transition-all duration-200 hover:bg-stone-50/80 first:rounded-t-xl last:rounded-b-xl"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-amber-50 to-amber-100/50">
                <Link2 className="h-5 w-5 text-amber-600" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-stone-800 truncate">
                    {link.title || link.code}
                  </h3>
                </div>
                <div className="flex items-center gap-3 mt-0.5 text-xs text-stone-500">
                  <span className="font-mono text-stone-400">{link.code}</span>
                  <span className="text-stone-300">•</span>
                  <span className="flex items-center gap-1">
                    <Clock size={11} />
                    {formatLastUsed(link.lastUsedAt)}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => copyLink(link.code, link.id)}
                  className="p-2 rounded-lg text-stone-400 hover:bg-stone-100 hover:text-stone-600 transition-colors"
                  title="Copy link"
                >
                  <Copy size={16} className={copiedId === link.id ? "text-emerald-500" : ""} />
                </button>
                <Link to="/$code" params={{ code: link.code }}>
                  <Button size="sm" variant="secondary">
                    <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                    Join
                  </Button>
                </Link>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
