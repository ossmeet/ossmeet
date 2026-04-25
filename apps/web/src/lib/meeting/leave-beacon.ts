interface LeaveMeetingBeaconInput {
  meetingId: string;
  participantId: string;
  finalizeIfEmpty?: boolean;
}

const LEAVE_ENDPOINT = "/api/meetings/leave";

export function notifyMeetingLeave({
  meetingId,
  participantId,
  finalizeIfEmpty = false,
}: LeaveMeetingBeaconInput): void {
  if (typeof window === "undefined") return;

  const payload = JSON.stringify({ meetingId, participantId, finalizeIfEmpty });

  // sendBeacon omits the Origin header, causing CSRF validation to reject the
  // request. Use fetch with keepalive instead — it sends Origin and works on
  // page unload in all modern browsers.
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
