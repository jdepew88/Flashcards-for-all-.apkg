// Two screens, one hash route.
//
// A full router would be more machinery than this needs: there are exactly two
// views, and the deck identifier only ever means something to the browser it
// was uploaded in. The hash keeps the browser Back button working (and makes a
// reload land where you were) without any server-side routing.

import { useCallback, useEffect, useState } from "react";
import { UploadScreen } from "@/components/upload-screen";
import { StudyScreen } from "@/components/study-screen";

const STUDY_PREFIX = "#/study/";

function slugFromHash(hash: string): string | null {
  if (!hash.startsWith(STUDY_PREFIX)) return null;
  const slug = decodeURIComponent(hash.slice(STUDY_PREFIX.length));
  return slug.length > 0 ? slug : null;
}

export function App() {
  const [slug, setSlug] = useState<string | null>(() => slugFromHash(window.location.hash));

  useEffect(() => {
    function onHashChange() {
      setSlug(slugFromHash(window.location.hash));
    }
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const study = useCallback((next: string) => {
    window.location.hash = `${STUDY_PREFIX}${encodeURIComponent(next)}`;
  }, []);

  const exit = useCallback(() => {
    // `pushState` rather than clearing the hash directly so the address bar
    // loses "#/study/…" without adding an extra entry the user has to Back
    // through twice.
    window.history.pushState(null, "", window.location.pathname + window.location.search);
    setSlug(null);
  }, []);

  return slug ? <StudyScreen slug={slug} onExit={exit} /> : <UploadScreen onStudy={study} />;
}
