import * as React from "react";
import type { Room } from "livekit-client";
import type { WikiArticle } from "@/components/meeting/wiki-search-panel";
import type { LiveKitChatMessage } from "./use-livekit-chat";

// Chat notification sound configuration
const CHAT_NOTIFICATION_VOLUME = 0.18;
const CHAT_NOTIFICATION_MIN_INTERVAL_MS = 300;
const CHAT_NOTIFICATION_SOUND_SRC = "/sounds/chat-notification.m4a";

interface MeetingUIOptions {
  chatMessages: LiveKitChatMessage[];
  currentUserId: string;
  roomInstance: Room | undefined;
  controlBarAutoHide: boolean;
  canModerate: boolean;
  isHandRaised: boolean;
  raiseHand: () => void;
  lowerHand: () => void;
  whiteboardWsUrl: string | null;
  whiteboardToken: string | null;
}

interface MeetingUIReturn {
  showChat: boolean;
  setShowChat: React.Dispatch<React.SetStateAction<boolean>>;
  showParticipants: boolean;
  setShowParticipants: React.Dispatch<React.SetStateAction<boolean>>;
  showHandQueue: boolean;
  setShowHandQueue: React.Dispatch<React.SetStateAction<boolean>>;
  showSearch: boolean;
  setShowSearch: React.Dispatch<React.SetStateAction<boolean>>;
  wikiQuery: string | undefined;
  remoteWikiSearch: { query: string; searcherName: string; article?: WikiArticle } | null;
  chatUnreadCount: number;
  controlsVisible: boolean;
  handleToggleChat: () => void;
  handleToggleParticipants: () => void;
  handleSearch: (query: string) => void;
  handleWikiBroadcast: (data: Record<string, unknown>) => void;
  handleWhiteboardCustomMessage: (data: unknown) => void;
  handleHandRaiseAction: () => void;
}

export function useMeetingUI(opts: MeetingUIOptions): MeetingUIReturn {
  const {
    chatMessages,
    currentUserId,
    roomInstance,
    controlBarAutoHide,
    canModerate,
    isHandRaised,
    raiseHand,
    lowerHand,
    whiteboardWsUrl,
    whiteboardToken,
  } = opts;

  const [showChat, setShowChat] = React.useState(false);
  const [showParticipants, setShowParticipants] = React.useState(false);
  const [showHandQueue, setShowHandQueue] = React.useState(false);
  const [showSearch, setShowSearch] = React.useState(false);
  const [wikiQuery, setWikiQuery] = React.useState<string | undefined>();
  const [remoteWikiSearch, setRemoteWikiSearch] = React.useState<{
    query: string;
    searcherName: string;
    article?: WikiArticle;
  } | null>(null);
  const [chatUnreadCount, setChatUnreadCount] = React.useState(0);
  const [controlsVisible, setControlsVisible] = React.useState(true);

  const hideTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousChatMessageCountRef = React.useRef(0);
  const chatNotificationAudioRef = React.useRef<HTMLAudioElement | null>(null);
  const lastChatSoundAtRef = React.useRef(0);

  const anyPanelOpen = showChat || showParticipants || showHandQueue;

  // Auto-hide controls on phone landscape
  React.useEffect(() => {
    if (!controlBarAutoHide) {
      setControlsVisible(true);
      return;
    }

    if (anyPanelOpen) {
      setControlsVisible(true);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      return;
    }

    const resetTimer = () => {
      setControlsVisible(true);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      hideTimerRef.current = setTimeout(() => setControlsVisible(false), 3000);
    };

    resetTimer();

    const opts: AddEventListenerOptions = { passive: true };
    window.addEventListener("pointerdown", resetTimer, opts);
    window.addEventListener("pointermove", resetTimer, opts);

    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      window.removeEventListener("pointerdown", resetTimer);
      window.removeEventListener("pointermove", resetTimer);
    };
  }, [controlBarAutoHide, anyPanelOpen]);

  const playChatNotificationSound = React.useCallback(() => {
    if (typeof window === "undefined") return;

    const now = Date.now();
    if (now - lastChatSoundAtRef.current < CHAT_NOTIFICATION_MIN_INTERVAL_MS) return;

    lastChatSoundAtRef.current = now;

    if (!chatNotificationAudioRef.current) {
      const audio = new Audio(CHAT_NOTIFICATION_SOUND_SRC);
      audio.preload = "auto";
      audio.volume = CHAT_NOTIFICATION_VOLUME;
      chatNotificationAudioRef.current = audio;
    }

    const audio = chatNotificationAudioRef.current;
    audio.currentTime = 0;
    audio.play().catch(() => {});
  }, []);

  // Chat unread count
  React.useEffect(() => {
    const nextCount = chatMessages.length;
    const prevCount = previousChatMessageCountRef.current;

    if (nextCount > prevCount) {
      const newMessages = chatMessages.slice(prevCount, nextCount);
      const localIdentity = roomInstance?.localParticipant.identity || currentUserId;
      const remoteMessages = newMessages.filter((m) => m.userId !== localIdentity);

      if (!showChat && remoteMessages.length > 0) {
        setChatUnreadCount((c) => c + remoteMessages.length);
        playChatNotificationSound();
      }
    }

    previousChatMessageCountRef.current = nextCount;
  }, [chatMessages, currentUserId, roomInstance, showChat, playChatNotificationSound]);

  React.useEffect(() => {
    if (showChat && chatUnreadCount !== 0) {
      setChatUnreadCount(0);
    }
  }, [showChat, chatUnreadCount]);

  // Cleanup audio element on unmount
  React.useEffect(() => {
    return () => {
      if (chatNotificationAudioRef.current) {
        chatNotificationAudioRef.current.pause();
        chatNotificationAudioRef.current.src = "";
        chatNotificationAudioRef.current = null;
      }
    };
  }, []);

  const handleToggleChat = React.useCallback(() => {
    setShowChat((prev) => {
      const next = !prev;
      if (next) {
        setChatUnreadCount(0);
        setShowHandQueue(false);
        setShowParticipants(false);
        setShowSearch(false);
      }
      return next;
    });
  }, []);

  const handleToggleParticipants = React.useCallback(() => {
    setShowParticipants((prev) => {
      const next = !prev;
      if (next) {
        setShowChat(false);
        setShowHandQueue(false);
        setShowSearch(false);
      }
      return next;
    });
  }, []);

  const handleSearch = React.useCallback((query: string) => {
    setWikiQuery(query);
    setShowSearch(true);
    setShowChat(false);
    setShowParticipants(false);
    setShowHandQueue(false);
    setRemoteWikiSearch(null);
  }, []);

  const handleWikiBroadcast = React.useCallback((data: Record<string, unknown>) => {
    if (!whiteboardWsUrl || !whiteboardToken) return;
    fetch(new URL("/broadcast", whiteboardWsUrl).toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${whiteboardToken}`,
      },
      body: JSON.stringify({ data }),
    }).catch(() => {});
  }, [whiteboardWsUrl, whiteboardToken]);

  const handleWhiteboardCustomMessage = React.useCallback((data: unknown) => {
    if (!data || typeof data !== "object") return;
    const msg = data as Record<string, unknown>;

    if (msg.type === "wiki.search" && typeof msg.query === "string") {
      setRemoteWikiSearch({
        query: msg.query,
        searcherName: typeof msg.searcherName === "string" ? msg.searcherName : "Someone",
      });
      setShowSearch(true);
      setShowChat(false);
      setShowParticipants(false);
      setShowHandQueue(false);
    }

    if (msg.type === "wiki.result" && typeof msg.query === "string") {
      setRemoteWikiSearch({
        query: msg.query,
        searcherName: typeof msg.searcherName === "string" ? msg.searcherName : "Someone",
        article: msg.article as WikiArticle | undefined,
      });
    }

    if (msg.type === "wiki.dismiss") {
      setRemoteWikiSearch(null);
      setShowSearch(false);
    }
  }, []);

  const handleHandRaiseAction = React.useCallback(() => {
    if (canModerate) {
      setShowHandQueue((prev) => {
        const next = !prev;
        if (next) setShowChat(false);
        return next;
      });
      return;
    }

    if (isHandRaised) {
      lowerHand();
    } else {
      raiseHand();
    }
  }, [canModerate, isHandRaised, lowerHand, raiseHand]);

  // Keyboard shortcuts
  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTyping =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT" ||
        target?.isContentEditable;
      if (isTyping) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      const key = event.key.toLowerCase();
      if (key === "escape") {
        if (showChat) setShowChat(false);
        if (showHandQueue) setShowHandQueue(false);
        return;
      }
      if (key === "c") {
        event.preventDefault();
        handleToggleChat();
      }
      if (key === "h") {
        event.preventDefault();
        handleHandRaiseAction();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showChat, showHandQueue, handleToggleChat, handleHandRaiseAction]);

  return {
    showChat,
    setShowChat,
    showParticipants,
    setShowParticipants,
    showHandQueue,
    setShowHandQueue,
    showSearch,
    setShowSearch,
    wikiQuery,
    remoteWikiSearch,
    chatUnreadCount,
    controlsVisible,
    handleToggleChat,
    handleToggleParticipants,
    handleSearch,
    handleWikiBroadcast,
    handleWhiteboardCustomMessage,
    handleHandRaiseAction,
  };
}
