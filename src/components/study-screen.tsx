// Adapted from CCNA Practice Labs — src/components/flashcards/flashcard-study-client.tsx.
//
// The media-resolution logic (turn bundled deck media into blob: URLs, rewrite
// bare filenames in the card HTML, revoke on unmount) is unchanged. Removed:
// the built-in CCNA deck registry, the Next.js search-param plumbing and the
// learning-analytics review tracker — this app has no built-in decks, no router
// and no analytics.

import { useEffect, useState } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { FlashcardViewer } from "@/components/flashcard-viewer";
import { loadUploadedDeck } from "@/lib/flashcards/uploaded-decks";
import { resolveDeckMedia } from "@/lib/flashcards/resolve-deck-media";
import type { FlashcardDeck } from "@/lib/flashcards/types";

type Status = "loading" | "ready" | "not-found";

export function StudyScreen({ slug, onExit }: { slug: string; onExit: () => void }) {
  const [status, setStatus] = useState<Status>("loading");
  const [deck, setDeck] = useState<FlashcardDeck | null>(null);

  useEffect(() => {
    let cancelled = false;
    const objectUrls: string[] = [];

    async function load() {
      setStatus("loading");
      setDeck(null);

      if (!slug) {
        if (!cancelled) setStatus("not-found");
        return;
      }

      const uploaded = await loadUploadedDeck(slug).catch(() => undefined);
      if (cancelled) return;
      if (!uploaded) {
        setStatus("not-found");
        return;
      }

      const mediaUrls = new Map<string, string>();
      for (const [filename, blob] of uploaded.media) {
        const url = URL.createObjectURL(blob);
        objectUrls.push(url);
        mediaUrls.set(filename, url);
      }
      setDeck(resolveDeckMedia(uploaded.deck, mediaUrls));
      setStatus("ready");
    }

    load();

    return () => {
      cancelled = true;
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [slug]);

  if (status === "loading") {
    return (
      <div className="mx-auto flex max-w-3xl flex-col items-center gap-3 px-4 py-24 text-muted-foreground sm:px-6">
        <Loader2 className="h-6 w-6 animate-spin" />
        <p className="text-sm">Loading deck…</p>
      </div>
    );
  }

  if (status === "not-found" || !deck) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center sm:px-6">
        <p className="text-lg font-semibold">We couldn&apos;t find that deck.</p>
        <p className="mt-2 text-sm text-muted-foreground">
          Decks are stored in this browser on this device, so a link opened somewhere else
          won&apos;t find it. Upload the file again to study it here.
        </p>
        <button
          onClick={onExit}
          className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-brand-blue hover:opacity-80"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to upload
        </button>
      </div>
    );
  }

  return <FlashcardViewer deck={deck} onExit={onExit} />;
}
