// Standalone test harness for the isolated lash engine (src/lash-engine/),
// mounted as an app route for convenience during local dev. See also
// /standalone-harness for a build of the same UI with zero app dependencies,
// deployable anywhere (e.g. GitHub Pages) for phone testing.
import { createFileRoute } from "@tanstack/react-router";
import { HarnessApp } from "@/lash-engine/harness/HarnessApp";

export const Route = createFileRoute("/lash-lab")({
  head: () => ({ meta: [{ title: "Lash Engine — Test Harness" }] }),
  component: HarnessApp,
});
