// Adapted from CCNA Practice Labs — src/components/flashcards/flashcard-study-client.tsx.
//
// The media-resolution logic (turn bundled deck media into blob: URLs, rewrite
// bare filenames in the card HTML, revoke on unmount) is unchanged. Removed:
// the built-in CCNA deck registry, the Next.js search-param plumbing and the
// learning-analytics review tracker — this app has no built-in decks, no router
// and no analytics. The loading and not-found states use the study layout, so
// opening a deck does not jump from one page shape to another.

import { useEffect, useState } from "react";
import { ArrowLeft, Layers } from "lucide-react";
import { FlashcardViewer } from "@/components/flashcard-viewer";
import { Button } from "@/components/ui/primitives";
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
      <div className="study-shell mx-auto flex w-full max-w-5xl flex-col" aria-busy="true">
        <div className="safe-top flex h-14 items-center gap-3">
          <div className="skeleton h-8 w-8 rounded-full" />
          <div className="skeleton mx-auto h-4 w-40 rounded-full" />
          <div className="skeleton h-8 w-8 rounded-full" />
        </div>
        <div className="flex min-h-0 flex-1 items-center justify-center pb-16 pt-4">
          <div className="skeleton h-full max-h-[38rem] w-full max-w-[40rem] rounded-[1.75rem]" />
        </div>
        <p className="sr-only" role="status">
          Loading deck…
        </p>
      </div>
    );
  }

  if (status === "not-found" || !deck) {
    return (
      <div className="page-gutter mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center py-16 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-surface-muted text-muted">
          <Layers className="h-6 w-6" />
        </span>
        <h1 className="mt-5 text-xl font-semibold tracking-tight">We couldn&apos;t find that deck.</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-muted">
          Decks are saved in this browser on this device, so a link opened somewhere else
          won&apos;t find it. Import the file again to study it here.
        </p>
        <Button className="mt-7" onClick={onExit}>
          <ArrowLeft className="h-4 w-4" />
          Back to your decks
        </Button>
      </div>
    );
  }

  return <FlashcardViewer deck={deck} onExit={onExit} />;
}
