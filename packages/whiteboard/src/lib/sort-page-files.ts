const PAGE_FILE_RE = /^page-(\d+)\.png$/;

function getPageNumber(filename: string): number | null {
  const match = filename.match(PAGE_FILE_RE);
  if (!match) return null;

  const pageNumber = Number.parseInt(match[1], 10);
  return Number.isFinite(pageNumber) ? pageNumber : null;
}

export function sortPageFiles(files: string[]): string[] {
  return [...files].sort((left, right) => {
    const leftPage = getPageNumber(left);
    const rightPage = getPageNumber(right);

    if (leftPage !== null && rightPage !== null && leftPage !== rightPage) {
      return leftPage - rightPage;
    }

    if (leftPage !== null && rightPage === null) return -1;
    if (leftPage === null && rightPage !== null) return 1;

    return left.localeCompare(right);
  });
}
