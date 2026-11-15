import { createFileRoute } from "@tanstack/react-router";
import { MizanRoot } from "@/components/finance/app";

function InviteTokenPage() {
  const { token } = Route.useParams();
  return <MizanRoot requestedInviteCode={token} />;
}

export const Route = createFileRoute("/invite/$token")({ component: InviteTokenPage });
