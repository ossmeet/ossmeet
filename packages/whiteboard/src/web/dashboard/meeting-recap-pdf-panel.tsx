import { useCallback, useMemo, useRef, useState } from "react";
import { Download, FileText, Loader2, Sparkles } from "lucide-react";
import type { Editor, TLAssetId, TLAssetStore, TLShapeId } from "tldraw";
import {
  type RoomSnapshotDocument,
  Tldraw,
  buildWhiteboardPdfBlob,
  roomSnapshotToStoreSnapshot,
} from "../../react";
import { whiteboardShapeUtils } from "../../lib/whiteboard-shapes";
import {
  getWhiteboardPdfDownloadUrl,
  getWhiteboardSnapshot,
} from "../server/meetings/whiteboard-export";
import type { getRoomLatestSummary } from "@/server/transcripts/room-recap";

type MeetingRecapSession = NonNullable<
  Awaited<ReturnType<typeof getRoomLatestSummary>>["session"]
>;

function getPdfPageIds(editor: Editor): TLShapeId[] {
  return editor
    .getCurrentPageShapesSorted()
    .filter((shape) => shape.type === "frame")
    .sort((a, b) => {
      const ay = typeof a.y === "number" ? a.y : 0;
      const by = typeof b.y === "number" ? b.y : 0;
      if (ay !== by) return ay - by;
      const ax = typeof a.x === "number" ? a.x : 0;
      const bx = typeof b.x === "number" ? b.x : 0;
      return ax - bx;
    })
    .map((shape) => shape.id);
}

function useWhiteboardPdfActions(
  sessionId: string,
  onGenerated?: () => void,
) {
  const [phase, setPhase] = useState<
    "idle" | "loading" | "rendering" | "uploading" | "opening"
  >("idle");
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<ReturnType<
    typeof roomSnapshotToStoreSnapshot
  > | null>(null);
  const [pendingExport, setPendingExport] = useState(false);
  const exportingRef = useRef(false);
  const prefetchOverrideRef = useRef<Map<TLAssetId, string> | null>(null);

  const assetStore = useMemo<TLAssetStore>(() => ({
    async upload(_asset, _file, _abortSignal) {
      return { src: "" };
    },
    resolve(asset, _ctx) {
      const cached = prefetchOverrideRef.current?.get(asset.id);
      if (cached) return cached;
      return asset.props.src ?? null;
    },
  }), []);

  const isBusy = phase !== "idle";

  const openExistingPdf = useCallback(async () => {
    setError(null);
    setPhase("opening");
    try {
      const { downloadUrl } = await getWhiteboardPdfDownloadUrl({
        data: { sessionId },
      });
      window.open(downloadUrl, "_blank");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open PDF.");
    } finally {
      setPhase("idle");
    }
  }, [sessionId]);

  const startGenerate = useCallback(async () => {
    setError(null);
    setPhase("loading");
    try {
      const result = await getWhiteboardSnapshot({ data: { sessionId } });
      if (!result.snapshot) {
        throw new Error("No whiteboard snapshot is available for this meeting.");
      }
      setSnapshot(
        roomSnapshotToStoreSnapshot(
          result.snapshot as { documents: RoomSnapshotDocument[] },
        ),
      );
      setPendingExport(true);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not load whiteboard snapshot.",
      );
      setPhase("idle");
    }
  }, [sessionId]);

  const handleEditorMount = useCallback(
    (editor: Editor) => {
      if (!pendingExport || exportingRef.current) return;
      exportingRef.current = true;

      void (async () => {
        setPhase("rendering");
        try {
          const pdf = await buildWhiteboardPdfBlob(
            editor,
            getPdfPageIds(editor),
            undefined,
            (map) => {
              prefetchOverrideRef.current = map;
            },
          );
          setPhase("uploading");
          const response = await fetch(
            `/api/whiteboard/pdf-upload?meetingId=${encodeURIComponent(sessionId)}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/pdf" },
              body: pdf,
              credentials: "same-origin",
            },
          );

          if (!response.ok) {
            throw new Error(`PDF upload failed: ${response.status}`);
          }

          setPendingExport(false);
          setSnapshot(null);
          onGenerated?.();
          await openExistingPdf();
        } catch (err) {
          setError(
            err instanceof Error
              ? err.message
              : "Could not generate whiteboard PDF.",
          );
        } finally {
          exportingRef.current = false;
          setPhase("idle");
        }
      })();
    },
    [onGenerated, openExistingPdf, pendingExport, sessionId],
  );

  const hiddenRenderer = useMemo(() => {
    if (!snapshot || !pendingExport) return null;
    return (
      <div
        aria-hidden="true"
        className="pointer-events-none fixed left-[-10000px] top-0 h-[900px] w-[1200px] overflow-hidden opacity-0"
      >
          <Tldraw
            snapshot={snapshot}
            assets={assetStore}
            shapeUtils={whiteboardShapeUtils}
            onMount={handleEditorMount}
          hideUi
          licenseKey={import.meta.env.VITE_TLDRAW_LICENSE_KEY || undefined}
        />
      </div>
    );
  }, [assetStore, handleEditorMount, pendingExport, snapshot]);

  return {
    error,
    phase,
    isBusy,
    hiddenRenderer,
    openExistingPdf,
    startGenerate,
  };
}

export function MeetingRecapPdfPanel({
  session,
}: {
  session: MeetingRecapSession;
  code: string;
}) {
  const [hasGeneratedPdf, setHasGeneratedPdf] = useState(
    session.hasWhiteboardPdf,
  );
  const actions = useWhiteboardPdfActions(session.sessionId, () => {
    setHasGeneratedPdf(true);
  });

  if (!session.hasWhiteboardState) return null;

  return (
    <div className="rounded-xl border border-neutral-200/60 bg-white/90 p-5 shadow-soft">
      {actions.hiddenRenderer}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-teal-100 p-2 text-teal-700">
            <FileText size={16} />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-neutral-900">
              Whiteboard PDF
            </h2>
            <p className="mt-1 text-sm text-neutral-500">
              Export the final whiteboard from this meeting.
            </p>
            {actions.error ? (
              <p className="mt-2 text-xs text-red-600">{actions.error}</p>
            ) : null}
          </div>
        </div>

        {hasGeneratedPdf ? (
          <button
            type="button"
            onClick={actions.openExistingPdf}
            disabled={actions.isBusy}
            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 text-xs font-medium text-teal-700 shadow-soft transition-colors hover:bg-neutral-50 disabled:opacity-50"
          >
            {actions.isBusy ? (
              <>
                <Loader2 size={13} className="animate-spin" />
                Opening...
              </>
            ) : (
              <>
                <Download size={13} />
                Download PDF
              </>
            )}
          </button>
        ) : session.isHost ? (
          <button
            type="button"
            onClick={actions.startGenerate}
            disabled={actions.isBusy}
            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-stone-900 px-3 text-xs font-medium text-white shadow-soft transition-colors hover:bg-stone-800 disabled:opacity-50"
          >
            {actions.isBusy ? (
              <>
                <Loader2 size={13} className="animate-spin" />
                {actions.phase === "loading"
                  ? "Loading..."
                  : actions.phase === "rendering"
                    ? "Rendering..."
                    : "Saving..."}
              </>
            ) : (
              <>
                <Sparkles size={13} />
                Generate PDF
              </>
            )}
          </button>
        ) : (
          <span className="text-xs text-neutral-400">
            The host can generate this PDF.
          </span>
        )}
      </div>
    </div>
  );
}
