let meetingWhiteboardModulePromise: Promise<typeof import("./meeting-whiteboard")> | null = null;

export function preloadMeetingWhiteboardModule() {
  if (!meetingWhiteboardModulePromise) {
    meetingWhiteboardModulePromise = import("./meeting-whiteboard").catch((err) => {
      meetingWhiteboardModulePromise = null;
      throw err;
    });
  }

  return meetingWhiteboardModulePromise;
}
