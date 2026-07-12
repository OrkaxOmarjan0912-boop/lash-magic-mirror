// Standalone test harness for the isolated lash engine (src/lash-engine/),
// mounted as an app route for convenience during local dev/tuning. See also
// /standalone-harness for a build of the same UI with zero app dependencies,
// deployable anywhere (e.g. GitHub Pages) for phone testing.
//
// Not linked from any nav and gated behind a query-string key so normal app
// users can't stumble onto it, while it stays reachable for future tuning
// in any environment (not just local dev). No sensitive data lives behind
// this gate — it's about keeping it out of the polished product surface,
// not access control — so a shared key is proportionate.
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { HarnessApp } from "@/lash-engine/harness/HarnessApp";

const ACCESS_KEY = "tune-lash-2026";

export const Route = createFileRoute("/lash-lab")({
  head: () => ({
    meta: [
      { title: "Lash Engine — Test Harness" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: LashLabGate,
});

function LashLabGate() {
  // Checked client-side only (not during SSR) so the server-rendered HTML
  // never reveals or hints at this page's content either way.
  const [allowed, setAllowed] = useState(false);
  useEffect(() => {
    const key = new URLSearchParams(window.location.search).get("key");
    setAllowed(key === ACCESS_KEY);
  }, []);
  if (!allowed) return null;
  return <HarnessApp />;
}
