import { AppShell, type AppShellUser } from "../organisms/app-shell";
import { DashboardTemplate } from "../templates/dashboard-template";

export function GitHubLikeDashboardPage({
  user,
  extensionUrl,
  extensionDownloadUrl,
  sidebar,
  main
}: {
  user?: AppShellUser;
  extensionUrl?: string;
  extensionDownloadUrl?: string;
  sidebar: React.ReactNode;
  main: React.ReactNode;
}): JSX.Element {
  return (
    <AppShell user={user} extensionUrl={extensionUrl} extensionDownloadUrl={extensionDownloadUrl}>
      <DashboardTemplate sidebar={sidebar} main={main} />
    </AppShell>
  );
}
