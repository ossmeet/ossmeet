interface LeaveMeetingBeaconInput {
  meetingId: string;
  participantId: string;
}

const LEAVE_ENDPOINT = "/api/meetings/leave";

export function notifyMeetingLeave({ meetingId, participantId }: LeaveMeetingBeaconInput): void {
  if (typeof window === "undefined") return;

  const payload = JSON.stringify({ meetingId, participantId });

  if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
    const blob = new Blob([payload], { type: "application/json" });
    if (navigator.sendBeacon(LEAVE_ENDPOINT, blob)) {
      return;
    }
  }

  void fetch(LEAVE_ENDPOINT, {
    method: "POST",
    credentials: "same-origin",
    keepalive: true,
    headers: {
      "Content-Type": "application/json",
    },
    body: payload,
  }).catch(() => undefined);
}
