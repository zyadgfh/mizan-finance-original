import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MizanRoot } from "../src/components/finance/app";
import "../src/styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Mizan root element was not found");

createRoot(root).render(
  <StrictMode>
    <MizanRoot />
  </StrictMode>,
);
