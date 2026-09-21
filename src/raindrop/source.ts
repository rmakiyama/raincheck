import type { Bookmark, BookmarkSource, FetchLike } from "../types.ts";
import { type RaindropRecord, SOURCE_NAME, toBookmark } from "./map.ts";

export type RaindropSourceOptions = {
  token: string;
  /** @default globalThis.fetch */
  fetch?: FetchLike;
  /** @default "https://api.raindrop.io" */
  baseUrl?: string;
  /** `0` = everything except Trash, `-1` = Unsorted. @default 0 */
  collectionId?: number;
  /** Clamped to Raindrop's hard cap of 50. @default 50 */
  perPage?: number;
};

/** Non-2xx response from Raindrop; `status` and the raw `body` are kept for diagnosis. */
export class RaindropHttpError extends Error {
  readonly status: number;
  readonly body: string;
  constructor(status: number, body: string) {
    super(`Raindrop HTTP ${status}: ${body}`);
    this.name = "RaindropHttpError";
    this.status = status;
    this.body = body;
  }
}

type ListResponse = { result: boolean; items: RaindropRecord[] };

/**
 * BookmarkSource over `GET /rest/v1/raindrops/{collectionId}`, newest first.
 * Read-only: never writes to Raindrop. Records rejected by `toBookmark` are
 * skipped and do not count toward `limit`. Throws `RaindropHttpError` on any
 * non-2xx page. https://developer.raindrop.io/v1/raindrops/multiple
 */
export function createRaindropSource(
  opts: RaindropSourceOptions,
): BookmarkSource {
  const fetchFn = opts.fetch ?? globalThis.fetch;
  const base = opts.baseUrl ?? "https://api.raindrop.io";
  const collectionId = opts.collectionId ?? 0;
  const perPage = Math.min(opts.perPage ?? 50, 50);

  return {
    name: SOURCE_NAME,
    async *fetch({ limit }): AsyncIterable<Bookmark> {
      let yielded = 0;
      for (let page = 0; ; page++) {
        if (limit !== undefined && yielded >= limit) return;
        const params = new URLSearchParams({
          perpage: String(perPage),
          page: String(page),
          sort: "-created",
        });
        const res = await fetchFn(
          `${base}/rest/v1/raindrops/${collectionId}?${params}`,
          {
            method: "GET",
            headers: { Authorization: `Bearer ${opts.token}` },
          },
        );
        if (!res.ok) throw new RaindropHttpError(res.status, await res.text());
        const data = (await res.json()) as ListResponse;
        const records = data.items ?? [];
        for (const r of records) {
          const bookmark = toBookmark(r);
          if (!bookmark) continue;
          yield bookmark;
          yielded++;
          if (limit !== undefined && yielded >= limit) return;
        }
        // The API has no "has more" flag; a short page is the only end signal.
        if (records.length < perPage) return;
      }
    },
  };
}
