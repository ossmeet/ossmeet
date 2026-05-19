import { useState, useRef, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createInvite, removeMember, addMemberByEmail } from "@/server/spaces";
import { queryKeys } from "@/lib/query-keys";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Users,
  Link as LinkIcon,
  UserMinus,
  UserPlus,
  Check,
  Copy,
} from "lucide-react";

interface SpaceMember {
  id: string;
  userId: string;
  role: string;
  user: {
    id: string;
    name: string;
    image: string | null;
  } | null;
}

const roleBadgeVariant = {
  owner: "primary" as const,
  admin: "warning" as const,
  member: "default" as const,
};

interface MembersListProps {
  spaceId: string;
  members: SpaceMember[];
  isAdmin: boolean;
}

export function MembersList({
  spaceId,
  members,
  isAdmin,
}: MembersListProps) {
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    return () => clearTimeout(copyTimerRef.current);
  }, []);

  const inviteMutation = useMutation({
    mutationFn: () => createInvite({ data: { spaceId, role: "member" } }),
    onSuccess: (result) => {
      setError(null);
      const url = `${window.location.origin}/invite/${result.token}`;
      setInviteLink(url);
    },
    onError: () => {
      setError("Failed to generate invite link. Please try again.");
    },
  });

  const handleCopy = async () => {
    if (!inviteLink) return;
    await navigator.clipboard.writeText(inviteLink);
    setCopied(true);
    clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div>
      {error && (
        <div className="mb-4 rounded-lg border border-danger-200 bg-danger-50 px-3 py-2 text-sm text-danger-700">
          {error}
        </div>
      )}

      {/* Admin actions */}
      {isAdmin && (
        <div className="mb-6 space-y-4">
          {/* Invite via link */}
          <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-medium text-neutral-900">
                  Invite people
                </h3>
                <p className="text-xs text-neutral-500">
                  Generate a link to invite new members
                </p>
              </div>
              {!inviteLink ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => inviteMutation.mutate()}
                  loading={inviteMutation.isPending}
                >
                  <LinkIcon size={14} />
                  Generate Link
                </Button>
              ) : (
                <Button size="sm" variant="secondary" onClick={handleCopy}>
                  {copied ? (
                    <Check size={14} className="text-success-600" />
                  ) : (
                    <Copy size={14} />
                  )}
                  {copied ? "Copied!" : "Copy Link"}
                </Button>
              )}
            </div>
            {inviteLink && (
              <div className="mt-3 truncate rounded-lg bg-white p-2 font-mono text-xs text-neutral-600 border border-neutral-200">
                {inviteLink}
              </div>
            )}
          </div>

          {/* Add member by email */}
          <AddMemberForm spaceId={spaceId} />
        </div>
      )}

      {/* Members list */}
      {members.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No members"
          description="Invite people to join this space."
        />
      ) : (
        <div className="space-y-2">
          {members.map((member) => (
            <MemberRow
              key={member.id}
              member={member}
              spaceId={spaceId}
              isAdmin={isAdmin}
              onError={setError}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- Add Member by Email ---------- */

function AddMemberForm({ spaceId }: { spaceId: string }) {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [success, setSuccess] = useState(false);
  // Track timeout to clear on unmount
  const successTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(successTimerRef.current), []);

  const mutation = useMutation({
    mutationFn: (memberEmail: string) =>
      addMemberByEmail({ data: { spaceId, email: memberEmail } }),
    onSuccess: async () => {
      setEmail("");
      setSuccess(true);
      clearTimeout(successTimerRef.current);
      successTimerRef.current = setTimeout(() => setSuccess(false), 3000);
      await queryClient.invalidateQueries({
        queryKey: queryKeys.spaces.detail(spaceId),
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.spaces.all(),
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    mutation.mutate(email.trim());
  };

  return (
    <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4">
      <h3 className="text-sm font-medium text-neutral-900">
        Add member directly
      </h3>
      <p className="text-xs text-neutral-500">
        Add an existing user by their email address
      </p>
      <form onSubmit={handleSubmit} className="mt-3 flex gap-2">
        <Input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="user@example.com"
          type="email"
          className="flex-1"
        />
        <Button
          type="submit"
          size="sm"
          variant="secondary"
          loading={mutation.isPending}
          disabled={!email.trim()}
        >
          <UserPlus size={14} />
          Add
        </Button>
      </form>
      {success && (
        <p className="mt-2 text-xs text-success-600">Member added.</p>
      )}
      {mutation.isError && (
        <p className="mt-2 text-xs text-danger-600">
          {mutation.error instanceof Error
            ? mutation.error.message
            : "Failed to add member."}
        </p>
      )}
    </div>
  );
}

/* ---------- Member Row ---------- */

function MemberRow({
  member,
  spaceId,
  isAdmin,
  onError,
}: {
  member: SpaceMember;
  spaceId: string;
  isAdmin: boolean;
  onError: (msg: string | null) => void;
}) {
  const queryClient = useQueryClient();

  const removeMutation = useMutation({
    mutationFn: () => removeMember({ data: { spaceId, userId: member.userId } }),
    onSuccess: async () => {
      onError(null);
      await queryClient.invalidateQueries({
        queryKey: queryKeys.spaces.detail(spaceId),
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.spaces.all(),
      });
    },
    onError: () => {
      onError("Failed to remove member. Please try again.");
    },
  });

  return (
    <div className="flex items-center justify-between rounded-xl border border-neutral-200 bg-white p-3 transition-colors hover:bg-neutral-50">
      <div className="flex items-center gap-3">
        <Avatar
          name={member.user?.name || "Unknown"}
          image={member.user?.image}
          size="sm"
        />
        <div>
          <p className="text-sm font-medium text-neutral-900">
            {member.user?.name || "Unknown"}
          </p>
          <p className="text-xs text-neutral-500">
            {member.role}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Badge
          variant={
            roleBadgeVariant[
              member.role as keyof typeof roleBadgeVariant
            ]
          }
        >
          {member.role}
        </Badge>
        {isAdmin && member.role !== "owner" && (
          <button
            onClick={() => removeMutation.mutate()}
            disabled={removeMutation.isPending}
            className="rounded-md p-1.5 text-neutral-400 transition-colors hover:bg-danger-50 hover:text-danger-500"
            title="Remove member"
            aria-label="Remove member"
          >
            <UserMinus size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
