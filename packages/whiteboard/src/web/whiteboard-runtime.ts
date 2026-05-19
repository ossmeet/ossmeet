import { MeetingRoomContent } from "./enhanced-meeting-room";
import { preloadMeetingWhiteboardModule } from "./preload-whiteboard";

export { MeetingRoomContent };

export async function preloadWhiteboard() {
  await preloadMeetingWhiteboardModule();
}
