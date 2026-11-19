// File: src/routes/zai.tsx — mounts the Z-Ai rebuild at /zai
import { createFileRoute } from "@tanstack/react-router";
import ZaiApp from "@/zai/App";

export const Route = createFileRoute("/zai")({ component: ZaiApp });
