import * as React from "react";
import { Send, MessageCircle, X } from "lucide-react";
import { cn } from "@ossmeet/shared";
import { useIOSKeyboard } from "@/lib/hooks/use-ios-keyboard";

const URL_REGEX = /https?:\/\/[^\s<>)"']+/g;

function Linkify({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  URL_REGEX.lastIndex = 0;
  while ((match = URL_REGEX.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const url = match[0];
    parts.push(
      <a
        key={match.index}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-accent-400 underline transition-colors hover:text-accent-300"
      >
        {url}
      </a>
    );
    lastIndex = match.index + url.length;
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return <>{parts}</>;
}

export interface ChatMessage {
  id: string;
  userId: string;
  userName: string;
  text: string;
  sentAt: number;
}

export interface ModernLiveChatProps {
  messages: ChatMessage[];
  currentUserId: string;
  onSendMessage: (text: string) => void;
  onClose?: () => void;
  hideHeader?: boolean;
  className?: string;
}

export function ModernLiveChat({
  messages,
  currentUserId,
  onSendMessage,
  onClose,
  hideHeader,
  className,
}: ModernLiveChatProps) {
  const [inputValue, setInputValue] = React.useState("");
  const keyboardOffset = useIOSKeyboard();
  const messagesContainerRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
  }, [messages]);

  const submitMessage = React.useCallback(() => {
    const trimmed = inputValue.trim();
    if (!trimmed || trimmed.length > 500) return;

    onSendMessage(trimmed);
    setInputValue("");
    inputRef.current?.focus();
  }, [inputValue, onSendMessage]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submitMessage();
  };

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-xl bg-white shadow-[0_8px_32px_-8px_rgba(0,0,0,0.15)] border border-stone-200",
        "animate-panel-slide-in",
        // Responsive width: full width on mobile, fixed on desktop
        "w-full max-w-80 md:w-80",
        className
      )}
    >
      {/* Header */}
      {!hideHeader && (
        <div className="flex items-center justify-between border-b border-stone-100 px-4 py-3.5 bg-stone-50/50">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-50 border border-teal-100">
              <MessageCircle className="h-4 w-4 text-teal-600" />
            </div>
            <div>
              <span className="block text-sm font-semibold text-stone-800">Chat</span>
              {messages.length > 0 && (
                <span className="text-xs text-stone-500">
                  {messages.length} {messages.length === 1 ? "message" : "messages"}
                </span>
              )}
            </div>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-stone-100"
              aria-label="Close chat"
            >
              <X className="h-4 w-4 text-stone-400 hover:text-stone-600" />
            </button>
          )}
        </div>
      )}

      {/* Messages */}
      <div
        ref={messagesContainerRef}
        className="flex-1 overflow-y-auto px-3 py-3 min-h-0"
      >
        {/* Info banner */}
        <div className="mb-4 rounded-lg bg-stone-50 px-3 py-2 text-center text-xs text-stone-500 border border-stone-100">
          <span>Messages are deleted when the meeting ends.</span>
        </div>

        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-stone-400 py-8">
            <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-xl bg-stone-50 border border-stone-100">
              <MessageCircle className="h-6 w-6 text-stone-300" />
            </div>
            <p className="text-sm font-medium text-stone-600">No messages yet</p>
            <p className="mt-1 text-xs text-stone-400">
              Say hello to break the ice!
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {messages.map((msg) => {
              const isOwn = msg.userId === currentUserId;
              return (
                <div
                  key={msg.id}
                  className={cn(
                    "flex flex-col max-w-[85%]",
                    isOwn ? "ml-auto items-end" : "mr-auto items-start"
                  )}
                >
                  {!isOwn && (
                    <span className="mb-1 px-1 text-xs font-medium text-stone-600">
                      {msg.userName}
                    </span>
                  )}
                  <div
                    className={cn(
                      "px-3.5 py-2.5 rounded-2xl text-sm break-words",
                      isOwn
                        ? "bg-teal-600 text-white rounded-br-md shadow-sm"
                        : "bg-stone-100 text-stone-800 rounded-bl-md border border-stone-200"
                    )}
                  >
                    <Linkify text={msg.text} />
                  </div>
                  <span className="mt-1 px-1 text-xs text-stone-400">
                    {formatTime(msg.sentAt)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Input */}
      <form
        onSubmit={handleSubmit}
        className="border-t border-stone-100 px-3 py-3 bg-stone-50/50 transition-[padding-bottom]"
        style={{
          paddingBottom:
            keyboardOffset > 0
              ? `calc(0.75rem + ${keyboardOffset}px)`
              : undefined,
        }}
      >
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Type a message..."
            maxLength={500}
            autoComplete="off"
            className="flex-1 rounded-lg border border-stone-200 bg-white px-4 py-2.5 text-sm text-stone-800 placeholder:text-stone-400 focus-visible:border-teal-400 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-teal-50 transition-all shadow-sm"
          />
          <button
            type="submit"
            onClick={submitMessage}
            disabled={!inputValue.trim()}
            className={cn(
              "inline-flex h-10 w-10 items-center justify-center rounded-lg bg-teal-600 text-white shadow-md transition-all",
              "hover:bg-teal-500 hover:shadow-lg",
              "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-teal-400",
              "disabled:cursor-not-allowed disabled:bg-stone-300 disabled:opacity-50"
            )}
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </form>
    </div>
  );
}
