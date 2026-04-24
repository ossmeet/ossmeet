import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CircleDollarSign, Link2, UserPlus, Video } from "lucide-react";
import { getPlanLimits, type PlanType } from "@ossmeet/shared";
import { createMeeting } from "@/server/meetings/crud";
import { beginMeetingEntryFlow } from "@/lib/meeting/entry-metrics";
import { sessionQueryOptions } from "@/queries/session";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";

const CODE_REGEX = /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/;

function formatCode(raw: string): string {
  const letters = raw.replace(/[^a-z]/g, "").slice(0, 10);
  if (letters.length <= 3) return letters;
  if (letters.length <= 7) return `${letters.slice(0, 3)}-${letters.slice(3)}`;
  return `${letters.slice(0, 3)}-${letters.slice(3, 7)}-${letters.slice(7)}`;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PermanentRoomDialog({ open, onOpenChange }: Props) {
  const [title, setTitle] = useState("");
  const [allowGuests, setAllowGuests] = useState(true);
  const [recordingEnabled, setRecordingEnabled] = useState(false);
  const [customCode, setCustomCode] = useState("");
  const [useCustomCode, setUseCustomCode] = useState(false);
  const [customCodeError, setCustomCodeError] = useState("");

  const { data: sessionData } = useQuery(sessionQueryOptions());
  const userPlan: PlanType = sessionData?.user?.plan ?? "free";
  const limits = getPlanLimits(userPlan);

  const createMutation = useMutation({
    mutationFn: () =>
      createMeeting({
        data: {
          title: title || undefined,
          allowGuests,
          recordingEnabled: recordingEnabled && limits.recordingEnabled,
          permanent: true,
          customCode: useCustomCode && customCode ? customCode : undefined,
        },
      }),
    onMutate: () => {
      beginMeetingEntryFlow({ source: "dashboard-permanent" });
    },
    onSuccess: (result) => {
      window.location.href = `/${result.code}`;
    },
  });

  function validateCustomCode(value: string): string {
    if (!value) return "";
    if (!CODE_REGEX.test(value)) return "Format must be abc-defg-hij";
    return "";
  }

  function handleCustomCodeChange(e: React.ChangeEvent<HTMLInputElement>) {
    const value = formatCode(e.target.value.toLowerCase());
    setCustomCode(value);
    setCustomCodeError(validateCustomCode(value));
  }

  function handleCreate() {
    if (useCustomCode && customCode) {
      const error = validateCustomCode(customCode);
      if (error) {
        setCustomCodeError(error);
        return;
      }
    }
    createMutation.mutate();
  }

  const canCreate = !createMutation.isPending && !(useCustomCode && !!customCodeError);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Permanent Room</DialogTitle>
          <DialogDescription>Create a reusable meeting link.</DialogDescription>
        </DialogHeader>

        <div className="px-6 py-4 space-y-4">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Room title (optional)"
            maxLength={200}
            className="w-full text-sm text-neutral-900 placeholder:text-neutral-400 bg-stone-50 border border-stone-200 rounded-xl px-3 py-2.5 outline-none focus:ring-2 focus:ring-accent-500/30 focus:border-accent-400"
          />

          {!limits.reusableMeetingLink ? (
            <div className="flex items-start gap-2.5 rounded-xl bg-amber-50 p-3">
              <CircleDollarSign className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-amber-800">Upgrade for permanent rooms</p>
                <p className="text-[11px] text-amber-700/80 mt-0.5">
                  Reusable links, custom codes, and recording with{" "}
                  <Link to="/pricing" className="font-bold underline underline-offset-2">
                    Pro or Org
                  </Link>
                  .
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <UserPlus className="h-4 w-4 text-stone-400" />
                  <span className="text-sm text-stone-700 font-medium">Allow guests</span>
                </div>
                <Checkbox
                  checked={allowGuests}
                  onCheckedChange={(v) => setAllowGuests(Boolean(v))}
                />
              </div>

              <div className={`flex items-center justify-between ${!limits.recordingEnabled && "opacity-60"}`}>
                <div className="flex items-center gap-2">
                  <Video className="h-4 w-4 text-stone-400" />
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm text-stone-700 font-medium">Recording</span>
                    {!limits.recordingEnabled && (
                      <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-700">
                        Pro
                      </span>
                    )}
                  </div>
                </div>
                <Checkbox
                  checked={recordingEnabled && limits.recordingEnabled}
                  onCheckedChange={(v) => {
                    if (limits.recordingEnabled) setRecordingEnabled(Boolean(v));
                  }}
                  disabled={!limits.recordingEnabled}
                />
              </div>

              {limits.customMeetingCode && (
                <div className="space-y-2">
                  <label className="flex cursor-pointer items-center gap-2 text-sm">
                    <Checkbox
                      checked={useCustomCode}
                      onCheckedChange={(checked) => {
                        setUseCustomCode(Boolean(checked));
                        if (!checked) {
                          setCustomCode("");
                          setCustomCodeError("");
                        }
                      }}
                    />
                    <span className="text-stone-700">Custom code</span>
                  </label>
                  {useCustomCode && (
                    <div>
                      <input
                        value={customCode}
                        onChange={handleCustomCodeChange}
                        placeholder="abc-defg-hij"
                        autoComplete="off"
                        autoCapitalize="none"
                        spellCheck={false}
                        className="h-9 w-full px-3 rounded-lg border border-neutral-300 text-sm font-mono tracking-wider transition-all focus:outline-none focus:ring-2 focus:ring-accent-500/30 focus:border-accent-500"
                        maxLength={12}
                      />
                      {customCodeError && (
                        <p className="mt-1 text-xs text-red-600">{customCodeError}</p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {createMutation.isError && (
            <p className="text-xs text-red-600 font-semibold">
              Failed to create room. Please try again.
            </p>
          )}
        </div>

        <DialogFooter>
          <DialogClose>
            <Button variant="ghost" size="sm">
              Cancel
            </Button>
          </DialogClose>
          <Button
            variant="primary"
            size="sm"
            loading={createMutation.isPending}
            onClick={handleCreate}
            disabled={!canCreate || !limits.reusableMeetingLink}
          >
            <Link2 className="mr-1.5 h-3.5 w-3.5" />
            Create Room
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
