/**
 * Shared R2 storage utilities for quota enforcement.
 *
 * Used by both the upload presigning flow and the PDF import grant flow
 * to compute per-prefix storage usage.
 */

const MAX_R2_LIST_PAGES = 100;

/** Minimal interface for R2 bucket list operations (avoids Env dependency). */
interface R2BucketLike {
  list(options: {
    prefix: string;
    limit: number;
    cursor?: string;
  }): Promise<{
    objects: { size: number }[];
    truncated: boolean;
    cursor?: string;
  }>;
}

/**
 * Sum the stored bytes for all objects under an R2 prefix.
 * Paginates through R2 list results and returns early once `stopAtBytes`
 * is reached (useful for quota checks where the exact total isn't needed).
 */
export async function getR2PrefixStoredBytes(
  bucket: R2BucketLike,
  prefix: string,
  stopAtBytes = Number.POSITIVE_INFINITY,
): Promise<number> {
  let total = 0;
  let cursor: string | undefined;
  for (let page = 0; page < MAX_R2_LIST_PAGES; page++) {
    const listed = await bucket.list({
      prefix,
      limit: 1000,
      ...(cursor ? { cursor } : {}),
    });

    for (const object of listed.objects) {
      total += object.size;
      if (total >= stopAtBytes) return total;
    }

    if (!listed.truncated || !listed.cursor) break;
    cursor = listed.cursor;
  }

  return total;
}
