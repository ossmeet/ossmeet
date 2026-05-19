import { handlePdfUpload } from "./api/whiteboard-pdf-upload";
import { handlePdfImportGrant } from "./api/whiteboard-pdf-import-grant";
import { handleSnapshot, handleSnapshotFetch } from "./api/whiteboard-snapshot";
import { handleAccess } from "./api/whiteboard-access";
import { handleWbAssets } from "./api/wb-assets";
import { handleAssistant } from "./api/ai-assistant";
import { handleWiki } from "./api/wiki";

export const whiteboardFetchHandler = async (
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
): Promise<Response | null> => {
  const url = new URL(request.url);

  if (url.pathname === "/api/whiteboard/access" && request.method === "POST") {
    return handleAccess(request, env);
  }
  if (url.pathname === "/api/whiteboard/pdf-upload" && request.method === "POST") {
    return handlePdfUpload(request, env);
  }
  if (url.pathname === "/api/whiteboard/pdf-import-grant" && request.method === "POST") {
    return handlePdfImportGrant(request, env);
  }
  if (url.pathname === "/api/whiteboard/snapshot" && request.method === "POST") {
    return handleSnapshot(request, env);
  }
  if (url.pathname === "/api/whiteboard/snapshot" && request.method === "GET") {
    return handleSnapshotFetch(request, env);
  }
  if (url.pathname.startsWith("/api/wb-assets/") && request.method === "GET") {
    return handleWbAssets(request, env, url.pathname.slice("/api/wb-assets/".length));
  }
  if (url.pathname === "/api/ai/assistant" && request.method === "POST") {
    return handleAssistant(request, env);
  }
  if (url.pathname === "/api/wiki" && request.method === "GET") {
    return handleWiki(request, env);
  }

  return null;
};
