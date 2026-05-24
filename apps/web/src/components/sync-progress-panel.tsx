import type { SyncProgress } from "@gitcurriculo/core";

interface SyncProgressPanelProps {
  progress: SyncProgress;
}

export function SyncProgressPanel({ progress }: SyncProgressPanelProps): JSX.Element {
  if (progress.phase === "idle") return <></>;

  const visibleRepos = progress.repoProgress.slice(-6).reverse();

  return (
    <div className="mt-3 space-y-3 rounded-md border border-[var(--gc-border)] bg-[var(--gc-surface)] p-3">
      <div>
        <div className="mb-1 flex items-center justify-between text-xs">
          <span className="font-semibold text-[var(--gc-text)]">Analise GitHub</span>
          <span className="font-bold text-[var(--gc-accent)]">{progress.overallPercent}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-[var(--gc-canvas-subtle)]">
          <div
            className="h-full rounded-full bg-[var(--gc-accent)] transition-all duration-300"
            style={{ width: `${progress.overallPercent}%` }}
          />
        </div>
        <p className="mt-1 text-[11px] text-[var(--gc-text-muted)]">{progress.phaseLabel}</p>
        {progress.currentRepo ? (
          <p className="text-[11px] text-[var(--gc-text)]">
            Repo atual: <strong>{progress.currentRepo}</strong> ({progress.currentRepoPercent}%)
          </p>
        ) : null}
        <p className="text-[10px] text-[var(--gc-text-subtle)]">
          {progress.reposCompleted}/{progress.reposTotal} repositorios concluidos
        </p>
      </div>

      {visibleRepos.length > 0 ? (
        <div className="space-y-2">
          {visibleRepos.map((repo) => (
            <div key={repo.repoName} className="rounded border border-[var(--gc-border)] px-2 py-1.5">
              <div className="mb-1 flex items-center justify-between gap-2 text-[11px]">
                <span className="truncate font-medium text-[var(--gc-text)]">{repo.repoName}</span>
                <span className="shrink-0 text-[var(--gc-text-muted)]">{repo.percent}%</span>
              </div>
              <div className="h-1 overflow-hidden rounded-full bg-[var(--gc-canvas-subtle)]">
                <div
                  className={[
                    "h-full rounded-full transition-all duration-300",
                    repo.status === "done"
                      ? "bg-[var(--gc-success)]"
                      : repo.status === "running"
                        ? "bg-[var(--gc-accent)]"
                        : "bg-[var(--gc-border)]"
                  ].join(" ")}
                  style={{ width: `${repo.percent}%` }}
                />
              </div>
              <p className="mt-1 text-[10px] text-[var(--gc-text-subtle)]">{repo.phaseLabel}</p>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
