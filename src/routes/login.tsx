import { createFileRoute } from "@tanstack/react-router";
import { MizanRoot } from "@/components/finance/app";

function LoginPage() {
  return <MizanRoot />;
}

export const Route = createFileRoute("/login")({ component: LoginPage });
