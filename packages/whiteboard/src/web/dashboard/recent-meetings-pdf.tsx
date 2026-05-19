import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Download, FileText, Loader2 } from "lucide-react";
import { getWhiteboardPdfDownloadUrl } from "../server/meetings/whiteboard-export";
import type { getMyRecentMeetings } from "@/server/meetings/crud";

type Meeting = Awaited<ReturnType<typeof getMyRecentMeetings>>["meetings"][number];

export function RecentMeetingsPdfCell({ meeting }: { meeting: Meeting }) {
  const navigate = useNavigate();
  const [downloading, setDownloading] = useState(false);

  if (!meeting.hasWhiteboardState) {
    return <span className="text-xs text-stone-300">—</span>;
  }

  if (meeting.hasWhiteboardPdf) {
    const handleDownload = async () => {
      setDownloading(true);
      try {
        const { downloadUrl } = await getWhiteboardPdfDownloadUrl({
          data: { sessionId: meeting.sessionId ?? meeting.id },
        });
        window.open(downloadUrl, "_blank");
      } finally {
        setDownloading(false);
      }
    };

    return (
      <button
        onClick={handleDownload}
        disabled={downloading}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-teal-600 transition-colors hover:text-teal-700 disabled:opacity-50"
      >
        {downloading ? (
          <>
            <Loader2 size={12} className="animate-spin" /> Opening…
          </>
        ) : (
          <>
            <Download size={12} /> Download
          </>
        )}
      </button>
    );
  }

  if (!meeting.isHost) {
    return <span className="text-xs text-stone-400">Host can generate</span>;
  }

  return (
    <button
      onClick={() => navigate({ to: "/dashboard/$code", params: { code: meeting.code } })}
      className="inline-flex items-center gap-1.5 text-xs font-medium text-stone-500 transition-colors hover:text-teal-600"
    >
      <FileText size={12} /> Generate PDF
    </button>
  );
}
