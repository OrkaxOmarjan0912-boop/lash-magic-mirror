import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HarnessApp } from "../src/lash-engine/harness/HarnessApp";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <HarnessApp />
  </StrictMode>,
);
