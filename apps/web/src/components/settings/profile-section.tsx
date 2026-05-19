import { useState, useRef, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { updateProfile } from "@/server/auth";
import { queryKeys } from "@/lib/query-keys";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar } from "@/components/ui/avatar";
import { Alert } from "@/components/ui/alert";
import { Check, User } from "lucide-react";
import { SettingsSection } from "./settings-section";

export function ProfileSection({ user }: { user: { name: string; email: string; image?: string | null } }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(user.name || "");
  const [success, setSuccess] = useState(false);
  const successTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(successTimerRef.current), []);

  const mutation = useMutation({
    mutationFn: (newName: string) => updateProfile({ data: { name: newName } }),
    onMutate: async (newName) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.session() });
      const previousSession = queryClient.getQueryData(queryKeys.session());
      queryClient.setQueryData(queryKeys.session(), (old) => {
        if (!old || typeof old !== "object") return old;
        const session = old as Record<string, unknown>;
        if (!session.user || typeof session.user !== "object") return old;
        return {
          ...session,
          user: { ...(session.user as Record<string, unknown>), name: newName },
        };
      });
      return { previousSession };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previousSession !== undefined) {
        queryClient.setQueryData(queryKeys.session(), ctx.previousSession);
      }
    },
    onSuccess: async () => {
      setSuccess(true);
      clearTimeout(successTimerRef.current);
      successTimerRef.current = setTimeout(() => setSuccess(false), 3000);
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.session() });
    },
  });

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    mutation.mutate(name.trim());
  };

  return (
    <SettingsSection icon={User} title="Profile">
      <div className="mb-6 flex items-center gap-4">
        <Avatar name={user.name || "User"} image={user.image} size="xl" />
        <div>
          <p className="font-medium text-neutral-900">{user.name}</p>
          <p className="text-sm text-neutral-500">{user.email}</p>
        </div>
      </div>
      <form onSubmit={handleSave} className="space-y-4">
        <Input
          label="Display name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <div>
          <Input label="Email" value={user.email || ""} disabled />
          <p className="mt-1 text-xs text-neutral-400">Email cannot be changed.</p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            type="submit"
            loading={mutation.isPending}
            disabled={!name.trim() || name.trim() === user.name}
          >
            Save changes
          </Button>
          {success && (
            <span className="inline-flex items-center gap-1 text-sm text-success-600">
              <Check size={14} />
              Saved
            </span>
          )}
        </div>
        {mutation.isError && (
          <Alert variant="error">
            {mutation.error instanceof Error ? mutation.error.message : "Failed to update profile."}
          </Alert>
        )}
      </form>
    </SettingsSection>
  );
}
