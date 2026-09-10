/**
 * Persistent-storage requests and quota reporting.
 *
 * ## What `navigator.storage.persist()` actually does
 *
 * By default an origin's IndexedDB data is "best-effort": the browser may evict
 * it when the device is short of space, without asking. Persistent storage
 * exempts the origin from that automatic eviction, so a deck someone imported
 * months ago is still there. That is worth asking for in an app whose entire
 * storage model is the user's own browser.
 *
 * What it is not: a guarantee. The user can still clear site data, use a
 * private window, or switch browsers, and some browsers grant persistence only
 * against engagement heuristics and never prompt at all. So this module is
 * written to be advisory — the app reads the answer to tell the user the truth
 * about their situation, and behaves identically whichever way it goes.
 *
 * Everything here degrades quietly: no support, a rejected promise, or a denied
 * request all produce a state the UI can render, never a thrown error.
 */

export type PersistenceState =
  /** The API is not available (older browser, or a non-secure context). */
  | { status: "unsupported" }
  /** Storage is exempt from automatic eviction. */
  | { status: "persisted" }
  /** Best-effort storage: it works, but the browser may evict it under pressure. */
  | { status: "best-effort" };

export interface StorageEstimate {
  usageBytes?: number;
  quotaBytes?: number;
}

function storageManager(): StorageManager | undefined {
  if (typeof navigator === "undefined") return undefined;
  return navigator.storage;
}

/** Reads the current state without prompting for anything. */
export async function readPersistenceState(): Promise<PersistenceState> {
  const storage = storageManager();
  if (!storage || typeof storage.persisted !== "function") return { status: "unsupported" };

  try {
    return (await storage.persisted()) ? { status: "persisted" } : { status: "best-effort" };
  } catch {
    return { status: "unsupported" };
  }
}

/**
 * Asks the browser to make this origin's storage persistent.
 *
 * Call it after a real user action such as a completed import — several
 * browsers weigh engagement when deciding, and some ignore the request outside
 * a user gesture entirely. A denial is a normal outcome, not an error: the app
 * keeps working, and the UI says so.
 */
export async function requestPersistentStorage(): Promise<PersistenceState> {
  const storage = storageManager();
  if (!storage || typeof storage.persist !== "function") return { status: "unsupported" };

  try {
    if (typeof storage.persisted === "function" && (await storage.persisted())) {
      return { status: "persisted" };
    }
    return (await storage.persist()) ? { status: "persisted" } : { status: "best-effort" };
  } catch {
    return { status: "unsupported" };
  }
}

/** Best-effort usage/quota figures. Both fields may be absent. */
export async function readStorageEstimate(): Promise<StorageEstimate> {
  const storage = storageManager();
  if (!storage || typeof storage.estimate !== "function") return {};

  try {
    const { usage, quota } = await storage.estimate();
    return { usageBytes: usage, quotaBytes: quota };
  } catch {
    return {};
  }
}

/** Formats a byte count for display. Returns undefined for undefined input. */
export function formatBytes(bytes: number | undefined): string | undefined {
  if (bytes === undefined || !Number.isFinite(bytes)) return undefined;
  if (bytes < 1024) return `${bytes} B`;

  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}
