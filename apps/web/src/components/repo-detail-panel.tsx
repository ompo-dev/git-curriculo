import React from "react";
import { GitBranch, GitMerge, GitPullRequest, Star, X } from "lucide-react";

import { buildRepoProfile, filterSubstantiveBullets, isCounterOverview, type RepoProfile } from "@gitcurriculo/core";

import { MarkdownPreview } from "./markdown-preview";

const LANG_COLORS: Record<string, string> = {
  TypeScript: "#3178c6",
  JavaScript: "#f1e05a",
  Python: "#3572a5",
  CSS: "#563d7c",
  HTML: "#e34c26",
  Rust: "#dea584",
  Go: "#00add8",
  Java: "#b07219",
  "C++": "#f34b7d",
  "C#": "#178600",
  Vue: "#41b883",
  Shell: "#89e051",
  Ruby: "#701516",
  Swift: "#f05138",
  Kotlin: "#a97bff",
  Dart: "#00b4ab",
  PHP: "#4f5d95",
  Scala: "#c22d40"
};

interface RepoDetailPanelProps {
  profile: RepoProfile;
  onClose: () => void;
}

export function RepoDetailPanel({ profile, onClose }: RepoDetailPanelProps): JSX.Element {
  const analysis = profile.analysis;
  const substantiveHighlights = analysis ? filterSubstantiveBullets(analysis.highlights) : [];
  const narrativeMarkdown = analysis
    ? [
        analysis.megaSummary?.trim(),
        analysis.narrative?.trim(),
        analysis.contributionOverview && !isCounterOverview(analysis.contributionOverview)
          ? analysis.contributionOverview
          : "",
        substantiveHighlights.length > 0
          ? ["## Destaques", ...substantiveHighlights.map(h => `- ${h}`)].join("\n")
          : ""
      ]
        .filter(Boolean)
        .join("\n\n")
    : "";

  return (
    <div className="rounded-md border border-[var(--gc-border)] bg-[var(--gc-surface)]">
      <div className="flex items-start justify-between gap-3 border-b border-[var(--gc-border)] px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-[var(--gc-accent)] break-all">{profile.repoName}</h2>
          <p className="text-xs text-[var(--gc-text-muted)]">{profile.fullName}</p>
          {profile.repo.description ? (
            <p className="mt-1 text-sm text-[var(--gc-text)]">{profile.repo.description}</p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded p-1 text-[var(--gc-text-muted)] hover:bg-[var(--gc-canvas-subtle)] hover:text-[var(--gc-text)]"
          aria-label="Fechar detalhes do repositorio"
        >
          <X size={16} />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 border-b border-[var(--gc-border)] px-4 py-3 sm:grid-cols-4">
        <Stat label="Commits" value={profile.commitCount} icon={<GitBranch size={13} />} />
        <Stat label="PRs" value={profile.pullRequestCount} icon={<GitPullRequest size={13} />} />
        <Stat label="Merged" value={profile.mergedPullRequestCount} icon={<GitMerge size={13} />} />
        <Stat label="Issues" value={profile.issueCount} icon={<Star size={13} />} />
      </div>

      {analysis ? (
        <>
          {narrativeMarkdown ? (
            <Section title="Problemas resolvidos e solucoes entregues">
              <MarkdownPreview content={narrativeMarkdown} variant="panel" />
            </Section>
          ) : null}

          {analysis.keyContributions && analysis.keyContributions.length > 0 ? (
            <Section title="Contribuicoes principais">
              <ul className="max-h-80 space-y-2 overflow-y-auto">
                {analysis.keyContributions.map(item => (
                  <li key={`${item.type}-${item.reference}`} className="rounded border border-[var(--gc-border)] px-2 py-1.5 text-xs">
                    <p className="font-medium text-[var(--gc-accent)]">
                      [{item.type} {item.reference}] {item.title}
                    </p>
                    <p className="mt-1 text-[var(--gc-text)]">
                      <span className="text-[var(--gc-text-muted)]">Problema/necessidade:</span> {item.what}
                    </p>
                    {item.how ? (
                      <p className="mt-0.5 text-[var(--gc-text)]">
                        <span className="text-[var(--gc-text-muted)]">Solucao:</span> {item.how}
                      </p>
                    ) : null}
                    {item.why ? (
                      <p className="mt-0.5 text-[var(--gc-text)]">
                        <span className="text-[var(--gc-text-muted)]">Contexto:</span> {item.why}
                      </p>
                    ) : null}
                    {item.impact ? (
                      <p className="mt-0.5 text-[var(--gc-text)]">
                        <span className="text-[var(--gc-text-muted)]">Resultado:</span> {item.impact}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}

          {substantiveHighlights.length > 0 && !narrativeMarkdown.includes("## Destaques") ? (
            <Section title="Destaques tecnicos">
              <MarkdownPreview
                content={substantiveHighlights.map(h => `- ${h}`).join("\n")}
                variant="panel"
              />
            </Section>
          ) : null}

          {analysis.engineeringInsights && analysis.engineeringInsights.length > 0 ? (
            <Section title="Decisoes de engenharia">
              <MarkdownPreview
                content={filterSubstantiveBullets(analysis.engineeringInsights).map(i => `- ${i}`).join("\n")}
                variant="panel"
              />
            </Section>
          ) : null}

          {analysis.architectureAnalysis && !isCounterOverview(analysis.architectureAnalysis) ? (
            <Section title="Arquitetura nas solucoes">
              <MarkdownPreview content={analysis.architectureAnalysis} variant="panel" />
            </Section>
          ) : null}

          {analysis.repoOrganization ? (
            <Section title="Organizacao do codigo">
              <MarkdownPreview content={analysis.repoOrganization} variant="panel" />
            </Section>
          ) : null}

          {analysis.quantifiedImpacts.length > 0 ? (
            <Section title="Resultados mensuraveis">
              <MarkdownPreview
                content={filterSubstantiveBullets(analysis.quantifiedImpacts).map(i => `- ${i}`).join("\n")}
                variant="panel"
              />
            </Section>
          ) : null}
        </>
      ) : null}

      {profile.technologies.length > 0 ? (
        <Section title="Stack detectada">
          <div className="flex flex-wrap gap-1.5">
            {profile.technologies.map(tech => (
              <span
                key={tech}
                className="rounded-full border border-[var(--gc-border)] bg-[var(--gc-canvas-subtle)] px-2 py-0.5 text-xs text-[var(--gc-text)]"
              >
                {tech}
              </span>
            ))}
          </div>
        </Section>
      ) : null}

      {profile.architectureSignals.length > 0 ? (
        <Section title="Padroes de engenharia">
          <div className="flex flex-wrap gap-1.5">
            {profile.architectureSignals.map(signal => (
              <span
                key={signal}
                className="rounded-full bg-[var(--gc-badge-success-bg)] px-2 py-0.5 text-xs text-[var(--gc-badge-success-text)]"
              >
                {signal}
              </span>
            ))}
          </div>
        </Section>
      ) : null}

      {profile.languages.length > 0 ? (
        <Section title="Linguagens">
          <div className="space-y-1">
            {profile.languages.map(lang => (
              <div key={lang.language} className="flex items-center gap-2 text-xs">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: LANG_COLORS[lang.language] ?? "#8b949e" }}
                />
                <span className="text-[var(--gc-text)]">{lang.language}</span>
                <span className="text-[var(--gc-text-muted)]">{(lang.share * 100).toFixed(1)}%</span>
              </div>
            ))}
          </div>
        </Section>
      ) : null}

      {profile.pullRequests.length > 0 ? (
        <Section title={`Pull Requests (${profile.pullRequests.length})`}>
          <ul className="max-h-64 space-y-2 overflow-y-auto">
            {profile.pullRequests.slice(0, 30).map(pr => (
              <li key={pr.id} className="rounded border border-[var(--gc-border)] px-2 py-1.5 text-xs">
                <a href={pr.url} target="_blank" rel="noopener noreferrer" className="font-medium text-[var(--gc-accent)] hover:underline">
                  #{pr.number} {pr.title}
                </a>
                {pr.analysisSummary ? (
                  <p className="mt-1 text-[var(--gc-text)]">{pr.analysisSummary}</p>
                ) : null}
                {pr.technologies && pr.technologies.length > 0 ? (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {pr.technologies.slice(0, 8).map(tech => (
                      <span key={tech} className="rounded bg-[var(--gc-canvas-subtle)] px-1.5 py-0.5 text-[10px]">{tech}</span>
                    ))}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {profile.commits.length > 0 ? (
        <Section title={`Commits (${profile.commits.length})`}>
          <ul className="max-h-72 space-y-2 overflow-y-auto">
            {profile.commits.slice(0, 40).map(commit => (
              <li key={commit.sha} className="rounded border border-[var(--gc-border)] px-2 py-1.5 text-xs">
                {commit.url ? (
                  <a href={commit.url} target="_blank" rel="noopener noreferrer" className="font-medium text-[var(--gc-accent)] hover:underline">
                    {commit.message.split("\n")[0]}
                  </a>
                ) : (
                  <span className="font-medium text-[var(--gc-text)]">{commit.message.split("\n")[0]}</span>
                )}
                {commit.analysisSummary ? (
                  <p className="mt-1 text-[var(--gc-text)]">{commit.analysisSummary}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {profile.issues.length > 0 ? (
        <Section title={`Issues (${profile.issues.length})`}>
          <ul className="max-h-40 space-y-1 overflow-y-auto">
            {profile.issues.slice(0, 20).map(issue => (
              <li key={issue.id} className="text-xs">
                <a href={issue.url} target="_blank" rel="noopener noreferrer" className="text-[var(--gc-accent)] hover:underline">
                  #{issue.number} {issue.title}
                </a>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="border-b border-[var(--gc-border)] px-4 py-3 last:border-b-0">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--gc-text-muted)]">{title}</h3>
      {children}
    </div>
  );
}

function Stat({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }): JSX.Element {
  return (
    <div className="rounded border border-[var(--gc-border)] bg-[var(--gc-canvas-subtle)] px-3 py-2">
      <div className="mb-1 flex items-center gap-1 text-[10px] uppercase tracking-wide text-[var(--gc-text-muted)]">
        {icon}
        {label}
      </div>
      <div className="text-lg font-semibold text-[var(--gc-text)]">{value}</div>
    </div>
  );
}
