import { Mic, MicOff, X, Crown, DoorOpen } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@ossmeet/shared";

interface Participant {
  id: string;
  name: string;
  role: "host" | "participant" | "guest";
  isSpeaking?: boolean;
  isMicOn?: boolean;
}

interface ParticipantsPanelProps {
  participants: Participant[];
  currentUserId?: string;
  onClose: () => void;
  hideHeader?: boolean;
  className?: string;
}

export function ModernParticipantsPanel({
  participants,
  currentUserId,
  onClose,
  hideHeader,
  className,
}: ParticipantsPanelProps) {
  const sortedParticipants = [...participants].sort((a, b) => {
    // Host first
    if (a.role === "host" && b.role !== "host") return -1;
    if (a.role !== "host" && b.role === "host") return 1;
    
    // Then current user
    if (a.id === currentUserId) return -1;
    if (b.id === currentUserId) return 1;
    
    // Then alphabetically
    return a.name.localeCompare(b.name);
  });

  const hostCount = participants.filter(p => p.role === "host").length;
  const guestCount = participants.filter(p => p.role === "guest").length;

  return (
    <div className={cn("flex flex-col overflow-hidden rounded-xl bg-white shadow-[0_8px_32px_-8px_rgba(0,0,0,0.15)] border border-stone-200 animate-panel-slide-in w-full max-w-80 md:w-80", className)}>
      {/* Header */}
      {!hideHeader && (
        <div className="flex items-center justify-between border-b border-stone-100 px-4 py-3.5 bg-stone-50/50">
          <div>
            <h2 className="text-sm font-semibold text-stone-800">
              Participants
            </h2>
            <p className="text-xs text-stone-500">
              {participants.length} {participants.length === 1 ? "person" : "people"}
              {hostCount > 0 && ` • ${hostCount} host${hostCount > 1 ? "s" : ""}`}
              {guestCount > 0 && ` • ${guestCount} guest${guestCount > 1 ? "s" : ""}`}
            </p>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-stone-100"
            aria-label="Close participants panel"
          >
            <X className="h-4 w-4 text-stone-400 hover:text-stone-600" />
          </button>
        </div>
      )}

      {/* Participants List */}
      <div className="flex-1 overflow-y-auto px-3 py-2">
        <div className="space-y-1">
          {sortedParticipants.map((p) => {
            const isYou = p.id === currentUserId;
            const isHost = p.role === "host";
            const isMicOn = p.isMicOn ?? true;

            return (
              <div
                key={p.id}
                className={cn(
                  "group flex items-center gap-3 rounded-lg px-3 py-2.5 transition-all",
                  "hover:bg-stone-50",
                  isYou && "bg-white border border-stone-200 shadow-sm"
                )}
              >
                {/* Avatar with status indicator */}
                <div className="relative">
                  <Avatar name={p.name} size="md" />
                  
                  {/* Speaking indicator */}
                  {p.isSpeaking && (
                    <div className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-teal-500 ring-2 ring-white">
                      <div className="h-1 w-1 animate-pulse rounded-full bg-white" />
                    </div>
                  )}
                </div>

                {/* Name & Role */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-stone-700">
                      {p.name}
                    </span>
                    
                    {/* Host badge */}
                    {isHost && (
                      <div
                        className="flex items-center gap-0.5 rounded-md bg-amber-50 px-1.5 py-0.5 border border-amber-100"
                        title="Host"
                      >
                        <Crown className="h-2.5 w-2.5 text-amber-600" fill="currentColor" />
                      </div>
                    )}
                    
                    {/* You badge */}
                    {isYou && (
                      <span className="rounded-md bg-teal-50 px-1.5 py-0.5 text-2xs font-medium text-teal-700 border border-teal-100">
                        You
                      </span>
                    )}
                  </div>
                  
                  {/* Role text for guests */}
                  {p.role === "guest" && !isYou && (
                    <div className="mt-0.5 flex items-center gap-1 text-xs text-stone-400">
                      <DoorOpen className="h-3 w-3" />
                      <span>Guest</span>
                    </div>
                  )}
                </div>

                {/* Mic status */}
                <div
                  className={cn(
                    "flex h-6 w-6 items-center justify-center rounded-md transition-colors",
                    isMicOn
                      ? "bg-emerald-50 border border-emerald-100"
                      : "bg-red-50 border border-red-100"
                  )}
                >
                  {isMicOn ? (
                    <Mic className="h-3 w-3 text-emerald-600" />
                  ) : (
                    <MicOff className="h-3 w-3 text-red-500" />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Footer info */}
      <div className="border-t border-stone-100 px-4 py-3 bg-stone-50/50">
        <div className="rounded-lg bg-stone-100 px-3 py-2 text-center text-xs text-stone-500 border border-stone-200">
          <p>Participants can't unmute themselves</p>
          <p className="mt-0.5">when host controls are enabled</p>
        </div>
      </div>
    </div>
  );
}
