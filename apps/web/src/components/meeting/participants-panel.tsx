import { Mic, X } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";

interface Participant {
  id: string;
  name: string;
  role: "host" | "participant" | "guest";
}

interface ParticipantsPanelProps {
  participants: Participant[];
  onClose: () => void;
}

export function ParticipantsPanel({
  participants,
  onClose,
}: ParticipantsPanelProps) {
  return (
    <div className="flex h-full w-80 flex-col border-l border-neutral-800 bg-neutral-900">
      <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
        <h2 className="text-sm font-semibold text-white">
          Participants ({participants.length})
        </h2>
        <button
          onClick={onClose}
          className="rounded-lg p-1.5 text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        <div className="space-y-1">
          {participants.map((p) => (
            <div
              key={p.id}
              className="flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-neutral-800/60"
            >
              <Avatar name={p.name} size="sm" />
              <div className="flex-1 min-w-0">
                <p className="truncate text-sm font-medium text-neutral-200">
                  {p.name}
                </p>
                {p.role === "host" && (
                  <p className="text-2xs text-accent-400">Host</p>
                )}
              </div>
              <Mic className="h-4 w-4 text-neutral-500" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
