import { createFileRoute } from "@tanstack/react-router";
import {
  SITE_NAME,
  createJsonLdScript,
  createPageHead,
  buildWebPageGraph,
} from "@/lib/seo";

export const Route = createFileRoute("/")({
  head: () => {
    const description =
      "Start or join a browser-based video meeting with a collaborative whiteboard, reusable rooms, transcripts, and no downloads required.";

    return createPageHead({
      title: `${SITE_NAME} — Free Video Meetings & Collaborative Whiteboards`,
      description,
      path: "/",
      scripts: [
        createJsonLdScript(
          buildWebPageGraph({
            title: `${SITE_NAME} — Free Video Meetings & Collaborative Whiteboards`,
            description,
            path: "/",
          }),
        ),
      ],
      extraMeta: [
        {
          name: "keywords",
          content:
            "video meetings, collaborative whiteboard, online meetings, browser meetings, open source meeting platform",
        },
      ],
      extraLinks: [
        {
          rel: "preload",
          href: "/fonts/inter-400.woff2",
          as: "font",
          type: "font/woff2",
          crossOrigin: "anonymous",
        },
        {
          rel: "preload",
          href: "/fonts/inter-700.woff2",
          as: "font",
          type: "font/woff2",
          crossOrigin: "anonymous",
        },
      ],
    });
  },
});
