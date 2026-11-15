import { createFileRoute } from "@tanstack/react-router";
import { MizanRoot } from "@/components/finance/app";

function AdminPage() {
  return <MizanRoot initialRoute={{ name: "admin" }} />;
}

export const Route = createFileRoute("/admin")({ component: AdminPage });
