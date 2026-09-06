import { createFileRoute } from "@tanstack/react-router";
import { CloudTeamPage } from "@/components/cloud-team/cloud-team-page";

export const Route = createFileRoute("/_authed/_app/cloud-team")({
  component: () => (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <CloudTeamPage />
    </div>
  ),
});
