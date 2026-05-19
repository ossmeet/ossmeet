import { createFileRoute } from "@tanstack/react-router";
import { createJsonLdScript, createPageHead, buildPricingGraph } from "@/lib/seo";

export const Route = createFileRoute("/pricing")({
  head: () =>
    createPageHead({
      title: "Pricing — OSSMeet",
      description:
        "Simple, transparent pricing for video meetings and collaborative whiteboards. Free tier available, with Pro and Organization plans for advanced features.",
      path: "/pricing",
      scripts: [createJsonLdScript(buildPricingGraph())],
    }),
});
