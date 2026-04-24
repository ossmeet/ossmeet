import { Link } from "@tanstack/react-router";
import { Globe, ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";

const roleBadgeVariant = {
  owner: "primary" as const,
  admin: "warning" as const,
  member: "default" as const,
};

// Deterministic gradient based on space name hash
function getGradient(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash << 5) - hash + name.charCodeAt(i);
    hash |= 0;
  }
  const gradients = [
    "from-violet-500 to-fuchsia-500",
    "from-amber-400 to-rose-400",
    "from-teal-400 to-emerald-500",
    "from-sky-400 to-indigo-500",
    "from-rose-400 to-orange-400",
    "from-indigo-400 to-cyan-400",
  ];
  return gradients[Math.abs(hash) % gradients.length];
}



interface SpaceCardProps {
  id: string;
  name: string;
  description?: string | null;
  role: string;
  index: number;
}

export function SpaceCard({ id, name, description, role, index }: SpaceCardProps) {
  const gradient = getGradient(name);

  return (
    <Link
      to="/spaces/$spaceId"
      params={{ spaceId: id }}
      className="group relative overflow-hidden bento-card h-full min-h-[160px] animate-fade-in-up border-0"
      style={{
        animationDelay: `${index * 50}ms`,
      }}
    >
      <div className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${gradient} transition-all duration-300 opacity-50 group-hover:opacity-100 group-hover:h-1.5`} />
      
      <div className="relative z-10 flex flex-col h-full bg-white p-5 transition-colors group-hover:bg-stone-50">
        <div className="flex items-start justify-between">
          <div className="rounded-xl bg-white/80 p-2.5 shadow-sm ring-1 ring-black/5">
            <Globe size={20} className="text-stone-700" />
          </div>
          <Badge variant={roleBadgeVariant[role as keyof typeof roleBadgeVariant]} className="bg-white/80 backdrop-blur-sm shadow-sm border-0 text-stone-700">
            {role}
          </Badge>
        </div>
        <div className="mt-4 flex-1">
          <h3 className="font-bold text-stone-900 group-hover:text-black transition-colors">{name}</h3>
          {description && (
            <p className="mt-1 line-clamp-2 text-sm text-stone-600 font-medium leading-relaxed">
              {description}
            </p>
          )}
        </div>
        <div className="mt-4 flex items-center text-sm font-semibold text-stone-900 opacity-0 translate-y-2 transition-all duration-300 group-hover:opacity-100 group-hover:translate-y-0">
          Open space
          <ArrowRight size={14} className="ml-1.5 transition-transform group-hover:translate-x-1" />
        </div>
      </div>
    </Link>
  );
}
