import * as React from "react";
import { Search, X, ExternalLink, Loader2, BookOpen, User, ImagePlus } from "lucide-react";
import { cn } from "@ossmeet/shared";
import { useIOSKeyboard } from "@/lib/hooks/use-ios-keyboard";

interface WikiImage {
  source: string;
  width?: number;
  height?: number;
}

export interface WikiArticle {
  title: string;
  extract: string;
  thumbnail?: WikiImage;
  originalimage?: WikiImage;
  content_urls?: { desktop: { page: string } };
}

function getArticleImage(article: WikiArticle): WikiImage | undefined {
  return article.originalimage ?? article.thumbnail;
}

function getArticleImageUrl(article: WikiArticle): string | undefined {
  return getArticleImage(article)?.source;
}

async function searchWikipedia(query: string): Promise<string[]> {
  const url = new URL("/api/wiki", window.location.origin);
  url.searchParams.set("type", "search");
  url.searchParams.set("q", query);

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error("Search failed");
  const data = await res.json() as {
    query?: { search?: Array<{ title: string }> };
  };
  return data.query?.search?.map((r) => r.title) ?? [];
}

async function getArticle(title: string): Promise<WikiArticle | null> {
  const articleUrl = new URL("/api/wiki", window.location.origin);
  articleUrl.searchParams.set("type", "article");
  articleUrl.searchParams.set("title", title);

  const summaryUrl = new URL("/api/wiki", window.location.origin);
  summaryUrl.searchParams.set("type", "summary");
  summaryUrl.searchParams.set("title", title);

  const [extractRes, summaryRes] = await Promise.all([
    fetch(articleUrl.toString()),
    fetch(summaryUrl.toString()),
  ]);

  let extract = "";
  if (extractRes.ok) {
    const data = await extractRes.json() as {
      query?: { pages?: Record<string, { extract?: string }> };
    };
    const pages = data.query?.pages;
    if (pages) {
      const page = Object.values(pages)[0];
      if (page?.extract) {
        extract = page.extract
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim();
      }
    }
  }

  let thumbnail: WikiArticle["thumbnail"] | undefined;
  let originalimage: WikiArticle["originalimage"] | undefined;
  let content_urls: WikiArticle["content_urls"] | undefined;
  if (summaryRes.ok) {
    const data = await summaryRes.json() as {
      thumbnail?: WikiImage;
      originalimage?: WikiImage;
      content_urls?: { desktop: { page: string } };
    };
    thumbnail = data.thumbnail;
    originalimage = data.originalimage;
    content_urls = data.content_urls;
  }

  if (!extract && !thumbnail && !originalimage) return null;
  return { title, extract, thumbnail, originalimage, content_urls };
}

type SearchState =
  | { type: "idle" }
  | { type: "searching"; query: string }
  | { type: "result"; article: WikiArticle }
  | { type: "no_results"; query: string }
  | { type: "error" };

export interface WikiSearchPanelProps {
  onClose?: () => void;
  triggerQuery?: string;
  className?: string;
  /** Name of the current user (shown as "searched by X") */
  userName?: string;
  /** Adds the current article image to the whiteboard when available */
  onAddImageToWhiteboard?: (imageUrl: string) => Promise<void>;
  /** Callback to broadcast search state to other participants */
  onBroadcastSearch?: (data: { type: "wiki.search"; query: string; searcherName: string } | { type: "wiki.result"; query: string; article: WikiArticle; searcherName: string } | { type: "wiki.dismiss" }) => void;
  /** Remote search state received from another participant */
  remoteSearch?: { query: string; searcherName: string; article?: WikiArticle } | null;
}

export function WikiSearchPanel({
  onClose,
  triggerQuery,
  className,
  userName,
  onAddImageToWhiteboard,
  onBroadcastSearch,
  remoteSearch,
}: WikiSearchPanelProps) {
  const [state, setState] = React.useState<SearchState>({ type: "idle" });
  const keyboardOffset = useIOSKeyboard();

  // Track whether we're the originator or viewing a remote search
  const [isRemote, setIsRemote] = React.useState(false);
  const [remoteSearcherName, setRemoteSearcherName] = React.useState("");
  const [isAddingImage, setIsAddingImage] = React.useState(false);
  const [addImageError, setAddImageError] = React.useState<string | null>(null);

  const runSearch = React.useCallback(async (query: string, broadcast = true) => {
    setState({ type: "searching", query });
    setIsRemote(false);

    if (broadcast && onBroadcastSearch) {
      onBroadcastSearch({ type: "wiki.search", query, searcherName: userName || "Someone" });
    }

    try {
      const titles = await searchWikipedia(query);
      if (!titles.length) {
        setState({ type: "no_results", query });
        return;
      }
      const article = await getArticle(titles[0]);
      if (!article) {
        setState({ type: "no_results", query });
        return;
      }
      setState({ type: "result", article });

      if (broadcast && onBroadcastSearch) {
        onBroadcastSearch({ type: "wiki.result", query, article, searcherName: userName || "Someone" });
      }
    } catch {
      setState({ type: "error" });
    }
  }, [onBroadcastSearch, userName]);

  // Handle incoming remote search
  React.useEffect(() => {
    if (!remoteSearch) return;
    setIsRemote(true);
    setRemoteSearcherName(remoteSearch.searcherName);
    if (remoteSearch.article) {
      setState({ type: "result", article: remoteSearch.article });
    } else {
      setState({ type: "searching", query: remoteSearch.query });
    }
  }, [remoteSearch]);

  // Auto-search when triggerQuery changes (fired from header search bar)
  const prevTriggerRef = React.useRef<string | undefined>(undefined);
  React.useEffect(() => {
    if (triggerQuery && triggerQuery !== prevTriggerRef.current) {
      prevTriggerRef.current = triggerQuery;
      runSearch(triggerQuery, true);
    }
  }, [triggerQuery, runSearch]);

  const handleDismiss = React.useCallback(() => {
    setState({ type: "idle" });
    setIsRemote(false);
    setRemoteSearcherName("");
    setAddImageError(null);
    onBroadcastSearch?.({ type: "wiki.dismiss" });
    onClose?.();
  }, [onClose, onBroadcastSearch]);

  // Determine the searcher attribution text
  const searcherLabel = isRemote ? remoteSearcherName : null;
  const articleImageUrl =
    state.type === "result" ? getArticleImageUrl(state.article) : undefined;
  const canAddImageToWhiteboard = Boolean(
    articleImageUrl && onAddImageToWhiteboard
  );

  const handleAddImage = React.useCallback(async () => {
    if (!articleImageUrl || !onAddImageToWhiteboard || isAddingImage) return;

    setIsAddingImage(true);
    setAddImageError(null);
    try {
      await onAddImageToWhiteboard(articleImageUrl);
    } catch (err) {
      setAddImageError(
        err instanceof Error ? err.message : "Could not add image to whiteboard"
      );
    } finally {
      setIsAddingImage(false);
    }
  }, [articleImageUrl, isAddingImage, onAddImageToWhiteboard]);

  const handleImageDragStart = React.useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!articleImageUrl) return;
      setAddImageError(null);
      event.dataTransfer.effectAllowed = "copy";
      event.dataTransfer.setData(
        "application/x-ossmeet-image-url",
        articleImageUrl
      );
      event.dataTransfer.setData("text/uri-list", articleImageUrl);
      event.dataTransfer.setData("text/plain", articleImageUrl);
    },
    [articleImageUrl]
  );

  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-2xl bg-zinc-800/60 shadow-2xl ring-1 ring-white/[0.08] backdrop-blur-2xl animate-panel-slide-in",
        "w-full max-w-80 md:w-80",
        className
      )}
      style={{
        paddingBottom: keyboardOffset > 0 ? `${keyboardOffset}px` : undefined
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-white/8 px-4 py-3">
        <BookOpen className="h-4 w-4 shrink-0 text-neutral-400" />
        <span className="flex-1 text-sm font-semibold text-white">
          {state.type === "searching"
            ? `Searching "${state.query}"…`
            : state.type === "result"
              ? state.article.title
              : "Search the internet"}
        </span>
        <button
          onClick={handleDismiss}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-neutral-400 transition-colors hover:bg-white/10 hover:text-white"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Searcher attribution */}
      {searcherLabel && (
        <div className="flex items-center gap-1.5 px-4 pt-2 pb-0">
          <User className="h-3 w-3 text-neutral-500" />
          <span className="text-xs text-neutral-500">
            Searched by {searcherLabel}
          </span>
        </div>
      )}

      {/* Content */}
      <div className="overflow-y-auto">
        {/* Idle */}
        {state.type === "idle" && (
          <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
            <Search className="h-8 w-8 text-neutral-700" />
            <p className="text-sm font-medium text-neutral-500">
              Type in the search bar above
            </p>
            <p className="max-w-[200px] text-xs text-neutral-600">
              Search Wikipedia and look up facts without leaving the meeting
            </p>
          </div>
        )}

        {/* Searching */}
        {state.type === "searching" && (
          <div className="flex flex-col items-center justify-center gap-3 px-4 py-10">
            <Loader2 className="h-6 w-6 animate-spin text-accent-400" />
            <p className="text-xs text-neutral-500">Looking up "{state.query}"…</p>
          </div>
        )}

        {/* Result */}
        {state.type === "result" && (
          <div className="flex flex-col gap-3 p-4">
            {articleImageUrl && (
              <div
                draggable={canAddImageToWhiteboard}
                onDragStart={handleImageDragStart}
                className="group overflow-hidden rounded-2xl border border-white/10 bg-white/5 shadow-lg"
              >
                <div className="relative">
                  <img
                    src={articleImageUrl}
                    alt={state.article.title}
                    className="h-48 w-full bg-white/5 object-contain"
                  />
                  {canAddImageToWhiteboard && (
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-stone-950/85 via-stone-950/30 to-transparent px-3 py-2 text-2xs font-medium text-white/85 opacity-100 md:opacity-0 md:transition-opacity md:group-hover:opacity-100">
                      <span>Drag image onto the whiteboard</span>
                      <span className="rounded-full bg-white/10 px-2 py-0.5 text-2xs uppercase tracking-[0.18em] text-white/70">
                        Image
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}
            {canAddImageToWhiteboard && (
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => { void handleAddImage(); }}
                  disabled={isAddingImage}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-white/8 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-white/12 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {isAddingImage ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ImagePlus className="h-3.5 w-3.5" />
                  )}
                  {isAddingImage ? "Adding image..." : "Add image to whiteboard"}
                </button>
                {addImageError && (
                  <p className="text-xs text-red-300">{addImageError}</p>
                )}
              </div>
            )}
            <p className="text-sm leading-relaxed text-neutral-200 line-clamp-[8]">
              {state.article.extract}
            </p>
            {state.article.content_urls?.desktop.page && (
              <a
                href={state.article.content_urls.desktop.page}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-xs font-medium text-accent-400 transition-colors hover:text-accent-300"
              >
                <ExternalLink className="h-3 w-3" />
                Read full article on Wikipedia
              </a>
            )}
          </div>
        )}

        {/* No results */}
        {state.type === "no_results" && (
          <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
            <Search className="h-7 w-7 text-neutral-700" />
            <p className="text-sm font-medium text-neutral-500">
              No results for "{state.query}"
            </p>
            <p className="text-xs text-neutral-600">Try a different search term</p>
          </div>
        )}

        {/* Error */}
        {state.type === "error" && (
          <div className="px-4 py-6 text-center">
            <p className="text-sm text-red-400">Search failed. Check your connection.</p>
          </div>
        )}
      </div>
    </div>
  );
}
