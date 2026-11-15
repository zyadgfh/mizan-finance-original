import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MizanRoot } from "../src/components/finance/app";
import "../src/styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Mizan root element was not found");

function readNativeStartupParams() {
  const params = new URLSearchParams(window.location.search);
  const inviteParam = params.get("invite")?.trim();
  const pathMatch = window.location.pathname.match(/\/invite\/([A-Za-z0-9-]+)/);
  const slugMatch = window.location.pathname.match(/\/t\/([a-z0-9-]+)/);
  return {
    requestedInviteCode: inviteParam || pathMatch?.[1] || undefined,
    requestedSlug: params.get("tenant")?.trim() || slugMatch?.[1] || undefined,
  };
}

const startup = readNativeStartupParams();

createRoot(root).render(
  <StrictMode>
    <MizanRoot
      requestedInviteCode={startup.requestedInviteCode}
      requestedSlug={startup.requestedSlug}
    />
  </StrictMode>,
);
