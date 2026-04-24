let meetingWhiteboardModulePromise: Promise<typeof import("@/components/meeting/meeting-whiteboard")> | null = null;

export function preloadMeetingWhiteboardModule() {
  if (!meetingWhiteboardModulePromise) {
    meetingWhiteboardModulePromise = import("@/components/meeting/meeting-whiteboard").catch((err) => {
      meetingWhiteboardModulePromise = null;
      throw err;
    });
  }

  return meetingWhiteboardModulePromise;
}
