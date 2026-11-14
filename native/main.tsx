import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { getRouter } from "../src/router";
import "../src/styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Mizan root element was not found");

const router = getRouter();
createRoot(root).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
