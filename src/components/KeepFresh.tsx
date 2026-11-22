"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * A screen left open is read again before its file links run out.
 *
 * The photographs, the documents of a lease and the attachments of a
 * request sit in a private bucket: what a page carries are links signed
 * when it was rendered, good for an hour. A tab left open longer would hand
 * the storage service's own error instead of the file. So a page that has
 * been on screen for three quarters of an hour is read again from the
 * server (the same re-read every saved change already triggers: what is
 * being typed stays), and a tab that was in the background is read again as
 * it comes back. Nothing here signs anything: the server does, under the
 * person's own session, exactly as on a first visit.
 */
export const FRESH_FOR_MS = 45 * 60_000;

export default function KeepFresh() {
  const router = useRouter();
  useEffect(() => {
    let readAt = Date.now();
    const check = () => {
      if (document.visibilityState !== "visible" || Date.now() - readAt < FRESH_FOR_MS) return;
      readAt = Date.now();
      router.refresh();
    };
    const timer = window.setInterval(check, 60_000);
    document.addEventListener("visibilitychange", check);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }, [router]);
  return null;
}
