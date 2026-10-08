"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * Drafts kept on the device, for the wizards whose work stays in memory
 * until the end: an état des lieux walked room by room, a property being
 * added. A back gesture, a reload while the camera is open or a tab Safari
 * drops would otherwise lose everything. The draft lives in IndexedDB,
 * which takes files as they are (the photographs), survives a reload, and
 * is cleared the moment the work is saved for real. Nothing leaves the
 * phone, and nothing is ever read back by the server.
 */

const DB = "morada-brouillons";
const STORE = "drafts";

export interface Draft<T> {
  v: number;
  savedAt: number;
  data: T;
}

export interface DraftBackend {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("blocked"));
  });
}

function run<T>(mode: IDBTransactionMode, op: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const r = op(t.objectStore(STORE));
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
        t.oncomplete = () => db.close();
        t.onabort = () => {
          db.close();
          reject(t.error);
        };
      }),
  );
}

const indexed: DraftBackend = {
  get: (key) => run("readonly", (s) => s.get(key)),
  set: (key, value) => run("readwrite", (s) => s.put(value, key)).then(() => undefined),
  remove: (key) => run("readwrite", (s) => s.delete(key)).then(() => undefined),
};

/** A browser without IndexedDB (an old private window, a test): drafts are simply not kept. */
const none: DraftBackend = {
  get: async () => undefined,
  set: async () => undefined,
  remove: async () => undefined,
};

let backend: DraftBackend | null = null;
function store(): DraftBackend {
  if (!backend) backend = typeof indexedDB === "undefined" ? none : indexed;
  return backend;
}

/** Tests swap the device's store for one in memory; null goes back to the device's. */
export function setDraftBackend(b: DraftBackend | null): void {
  backend = b;
}

export function memoryDraftBackend(): DraftBackend {
  const m = new Map<string, unknown>();
  return {
    get: async (k) => m.get(k),
    set: async (k, v) => {
      m.set(k, v);
    },
    remove: async (k) => {
      m.delete(k);
    },
  };
}

/** The draft under `key`, when the device holds one written by this version of the wizard. */
export async function readDraft<T>(key: string, version: number): Promise<Draft<T> | null> {
  try {
    const raw = (await store().get(key)) as Partial<Draft<T>> | undefined;
    if (!raw || raw.v !== version || typeof raw.savedAt !== "number" || raw.data === undefined) return null;
    return raw as Draft<T>;
  } catch {
    return null;
  }
}

export async function writeDraft<T>(key: string, version: number, data: T): Promise<void> {
  try {
    const draft: Draft<T> = { v: version, savedAt: Date.now(), data };
    await store().set(key, draft);
  } catch {
    // A full or refused store: the work goes on, without a draft.
  }
}

export async function clearDraft(key: string): Promise<void> {
  try {
    await store().remove(key);
  } catch {
    // Nothing to clear.
  }
}

/** How long after the last change the draft is written (ms). */
export const DRAFT_DELAY = 500;

/**
 * Keeps `data` as the draft under `key` while `active`, a moment after each
 * change. On mount it reads what the device holds and hands it to `onFound`
 * once, so the wizard can offer to resume. `clear` drops the draft once the
 * work is saved for real.
 */
export function useDraft<T>(
  key: string,
  version: number,
  data: T,
  active: boolean,
  onFound: (draft: Draft<T>) => void,
): () => Promise<void> {
  const found = useRef(onFound);
  found.current = onFound;
  // Writes wait for the first read: a draft must never be overwritten before it was offered.
  const ready = useRef(false);

  useEffect(() => {
    let on = true;
    ready.current = false;
    void readDraft<T>(key, version).then((draft) => {
      if (!on) return;
      ready.current = true;
      if (draft) found.current(draft);
    });
    return () => {
      on = false;
    };
  }, [key, version]);

  useEffect(() => {
    if (!active) return;
    const t = setTimeout(() => {
      if (ready.current) void writeDraft(key, version, data);
    }, DRAFT_DELAY);
    return () => clearTimeout(t);
  }, [key, version, data, active]);

  return useCallback(() => clearDraft(key), [key]);
}

/** When a draft was saved, for the prompt offering to resume it, in the page's language. */
export function draftDate(savedAt: number, lang?: string): string {
  try {
    return new Intl.DateTimeFormat(lang || (typeof document !== "undefined" ? document.documentElement.lang : "fr") || "fr", {
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
    }).format(savedAt);
  } catch {
    return new Date(savedAt).toLocaleString();
  }
}

/**
 * Warns before the page is left while unsaved work is on it (a closed tab,
 * a typed address). iOS Safari shows no prompt, which is what the draft is
 * for; every other browser asks first.
 */
export function useUnloadGuard(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Older browsers read the string; modern ones only need the call above.
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [active]);
}
