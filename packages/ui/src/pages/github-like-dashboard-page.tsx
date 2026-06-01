"use client";

import { AppShell, type AppShellUser } from "../organisms/app-shell";
import { DashboardTemplate } from "../templates/dashboard-template";

export function GitHubLikeDashboardPage({
  user,
  sidebar,
  main
}: {
  user?: AppShellUser;
  sidebar: React.ReactNode;
  main: React.ReactNode;
}): JSX.Element {
  return (
    <AppShell user={user}>
      <DashboardTemplate sidebar={sidebar} main={main} />
    </AppShell>
  );
}
