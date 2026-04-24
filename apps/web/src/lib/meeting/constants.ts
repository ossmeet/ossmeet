/**
 * LiveKit data channel topic constants
 * Centralized to avoid typos and ensure consistency
 */
export const LIVEKIT_TOPICS = {
  CHAT: "chat",
  REACTIONS: "reactions",
  HAND: "hand",
  CAPTIONS: "captions",
  SCREEN_SHARE: "screen_share",
} as const;

/**
 * Validation limits for messages
 */
export const MESSAGE_LIMITS = {
  MAX_TEXT_LENGTH: 500,
  MAX_NAME_LENGTH: 100,
  MAX_EMOJI_LENGTH: 10,
  MAX_CAPTION_LENGTH: 300,
} as const;
