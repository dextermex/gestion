"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

/**
 * The last resort: an error the root layout itself could not survive. It is
 * reported (scrubbed, see src/lib/monitoring.ts) and the person gets one
 * plain page with one way out. This file replaces the root layout when it
 * renders, so it carries its own html and body and cannot read the
 * dictionaries: the two lines are written in French, the product's default.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="fr">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#faf8f4", color: "#1f2924" }}>
        <main style={{ maxWidth: 480, margin: "20vh auto 0", padding: "0 24px", textAlign: "center" }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.01em" }}>Une erreur est survenue.</h1>
          <p style={{ marginTop: 12, fontSize: 15, lineHeight: 1.6, color: "#5c6660" }}>
            La page n&apos;a pas pu s&apos;afficher. Réessayez : si le problème persiste, il nous a été signalé.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: 24,
              minHeight: 44,
              padding: "10px 20px",
              borderRadius: 12,
              border: 0,
              background: "#0f6e6e",
              color: "#fff",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Réessayer
          </button>
        </main>
      </body>
    </html>
  );
}
