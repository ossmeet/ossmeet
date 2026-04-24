import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { leaveSpace } from "@/server/spaces";
import { queryKeys } from "@/lib/query-keys";
import { ArrowLeft, LogOut } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

const roleBadgeVariant = {
  owner: "primary" as const,
  admin: "warning" as const,
  member: "default" as const,
};

function getGradient(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash << 5) - hash + name.charCodeAt(i);
    hash |= 0;
  }
  const gradients = [
    "from-accent-600 to-accent-800",
    "from-amber-500 to-amber-700",
    "from-violet-500 to-violet-700",
    "from-rose-400 to-rose-600",
    "from-teal-600 to-teal-800",
    "from-emerald-500 to-emerald-700",
  ];
  return gradients[Math.abs(hash) % gradients.length];
}

interface SpaceHeaderProps {
  spaceId: string;
  name: string;
  description?: string | null;
  role: string;
  memberCount: number;
}

export function SpaceHeader({ spaceId, name, description, role, memberCount }: SpaceHeaderProps) {
  const gradient = getGradient(name);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [leaveOpen, setLeaveOpen] = useState(false);

  const leaveMutation = useMutation({
    mutationFn: () => leaveSpace({ data: { spaceId } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.spaces.all() });
      navigate({ to: "/spaces" });
    },
  });

  return (
    <div className="mb-6">
      <Link
        to="/spaces"
        className="mb-3 inline-flex items-center gap-1 text-sm text-neutral-500 transition-colors hover:text-neutral-700"
      >
        <ArrowLeft size={16} />
        Back to Spaces
      </Link>

      {/* Cover gradient bar */}
      <div className={`-mx-4 sm:-mx-6 mb-6 h-24 rounded-xl bg-gradient-to-r ${gradient} relative overflow-hidden`}>
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_30%,rgba(255,255,255,0.1),transparent_60%)]" />
      </div>

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">{name}</h1>
          {description && (
            <p className="mt-1 text-sm text-neutral-500">{description}</p>
          )}
          <p className="mt-1 text-xs text-neutral-400">
            {memberCount} member{memberCount !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={roleBadgeVariant[role as keyof typeof roleBadgeVariant]}>
            {role}
          </Badge>
          {role !== "owner" && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setLeaveOpen(true)}
              className="text-neutral-500 hover:text-danger-600"
            >
              <LogOut size={14} />
              Leave
            </Button>
          )}
        </div>
      </div>

      {/* Leave confirmation dialog */}
      <Dialog open={leaveOpen} onOpenChange={setLeaveOpen}>
        <DialogContent size="sm">
          <div className="p-6">
            <DialogTitle>Leave space</DialogTitle>
            <DialogDescription>
              Are you sure you want to leave &ldquo;{name}&rdquo;? You will lose
              access to this space and its assets.
            </DialogDescription>
            <div className="mt-5 flex justify-end gap-3">
              <Button
                variant="secondary"
                onClick={() => setLeaveOpen(false)}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={() => leaveMutation.mutate()}
                loading={leaveMutation.isPending}
              >
                Leave space
              </Button>
            </div>
            {leaveMutation.isError && (
              <p className="mt-3 text-sm text-danger-600">
                {leaveMutation.error instanceof Error
                  ? leaveMutation.error.message
                  : "Failed to leave space."}
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
