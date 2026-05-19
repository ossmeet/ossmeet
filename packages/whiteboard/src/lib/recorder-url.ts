export function buildRecorderUrl(
  appUrl: string,
  whiteboardUrl: string,
  wbToken: string,
  options: { meetingCode?: string | null } = {},
): string {
  const hash = new URLSearchParams({
    wb_url: whiteboardUrl,
    wb_token: wbToken,
  });
  if (options.meetingCode) {
    hash.set("meeting_code", options.meetingCode);
  }
  return `${appUrl}/recorder#${hash.toString()}`;
}
