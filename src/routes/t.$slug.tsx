import { createFileRoute } from "@tanstack/react-router";
import { MizanRoot } from "@/components/finance/app";

function TenantSlugPage() {
  const { slug } = Route.useParams();
  return <MizanRoot requestedSlug={slug} />;
}

export const Route = createFileRoute("/t/$slug")({ component: TenantSlugPage });
