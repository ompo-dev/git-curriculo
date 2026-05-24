export function DashboardTemplate({
  sidebar,
  main
}: {
  sidebar: React.ReactNode;
  main: React.ReactNode;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
      {/* Sidebar: full-width on mobile/tablet, fixed 268px on desktop */}
      <aside className="w-full lg:w-[268px] lg:shrink-0">{sidebar}</aside>
      {/* Main: full-width, grows to fill remaining space on desktop */}
      <div className="min-w-0 flex-1">{main}</div>
    </div>
  );
}
