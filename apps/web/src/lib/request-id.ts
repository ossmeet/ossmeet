export const REQUEST_ID_HEADER = "X-Request-ID";

export function getOrCreateRequestId(request: Request): string {
  return request.headers.get(REQUEST_ID_HEADER) ?? crypto.randomUUID();
}

export function withRequestIdHeader(request: Request, requestId: string): Request {
  if (request.headers.get(REQUEST_ID_HEADER) === requestId) {
    return request;
  }

  const headers = new Headers(request.headers);
  headers.set(REQUEST_ID_HEADER, requestId);
  return new Request(request, { headers });
}

export function withRequestId(response: Response, requestId: string): Response {
  if (response.headers.get(REQUEST_ID_HEADER) === requestId) {
    return response;
  }

  const headers = new Headers(response.headers);
  headers.set(REQUEST_ID_HEADER, requestId);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
