// Cloudflare Workers free plan allows 50 subrequests per invocation; stay under it.
export const SUBREQUEST_LIMIT = 45;

let used = 0;

/** Workers reuse isolates, so every entry point must reset before scraping. */
export function resetSubrequestBudget(): void {
  used = 0;
}

export function subrequestsUsed(): number {
  return used;
}

/** Reserve one subrequest. Returns false once the invocation budget is spent. */
export function takeSubrequest(): boolean {
  if (used >= SUBREQUEST_LIMIT) return false;
  used += 1;
  return true;
}
