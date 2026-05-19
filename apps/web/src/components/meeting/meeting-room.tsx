import { MeetingRoomLayout } from "@/components/meeting/meeting-room-layout";
import { MeetingRoomContent as MeetingRoomContentImpl } from "@whiteboard/runtime";
import {
  useMeetingRoom,
  type MeetingLifecycleHooks,
  type MeetingRoomContentProps,
} from "@/lib/meeting/use-meeting-room";

/**
 * Base meeting room content.
 *
 * Addon profiles may provide a replacement meeting room component through
 * `@whiteboard/runtime`, but the core app remains the only stable import path.
 */
export function BaseMeetingRoomContent(
  props: MeetingRoomContentProps & {
    lifecycleHooks?: MeetingLifecycleHooks;
    broadcastWikiSearch?: (data: Record<string, unknown>) => void;
  },
) {
  const meeting = useMeetingRoom(
    props,
    props.lifecycleHooks,
    props.broadcastWikiSearch,
  );

  return <MeetingRoomLayout meeting={meeting} />;
}

export function MeetingRoomContent(
  props: MeetingRoomContentProps & {
    lifecycleHooks?: MeetingLifecycleHooks;
    broadcastWikiSearch?: (data: Record<string, unknown>) => void;
  },
) {
  return <MeetingRoomContentImpl {...props} />;
}
