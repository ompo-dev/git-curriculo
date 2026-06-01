import { Elysia, t } from "elysia";

import {
  AiAtsAnalyzer,
  AtsBlueprintSchema,
  CoverLetterService,
  DeepSeekResumeProvider,
  GitHubProfileSnapshotSchema,
  JobSpecSchema,
  MetricsService,
  ResumeService,
  SyncService,
  analyzeResumeQuality,
  type GitHubProfileSnapshot
} from "@gitcurriculo/core";

import { createSseStream } from "../lib/sse";

export const apiRoutes = new Elysia({ prefix: "" })
  .post(
    "/sync",
    async ({ body }) => {
      const { githubToken, deepseekApiKey, since, existingSnapshot } = body as {
        githubToken: string;
        deepseekApiKey?: string;
        since?: string;
        existingSnapshot?: GitHubProfileSnapshot;
      };

      return createSseStream(async (send) => {
        const syncService = new SyncService();
        const incremental = await syncService.runManualSync({
          token: githubToken,
          deepseekApiKey,
          since,
          onProgress: (progress) => {
            send("progress", { ...syncService.getLastSyncStatus(), progress });
          }
        });

        const finalSnapshot =
          existingSnapshot && since
            ? syncService.mergeSnapshots(existingSnapshot, incremental)
            : incremental;

        send("result", { snapshot: finalSnapshot, syncStatus: syncService.getLastSyncStatus() });
      });
    },
    {
      body: t.Object({
        githubToken: t.String(),
        deepseekApiKey: t.Optional(t.String()),
        since: t.Optional(t.String()),
        existingSnapshot: t.Optional(t.Unknown())
      })
    }
  )
  .post(
    "/metrics",
    ({ body }) => {
      const snapshot = GitHubProfileSnapshotSchema.parse(body.snapshot);
      const metrics = new MetricsService().computeProfileMetrics({
        profileSnapshot: snapshot,
        windowMonths: body.windowMonths ?? 24
      });
      return { metrics };
    },
    {
      body: t.Object({
        snapshot: t.Unknown(),
        windowMonths: t.Optional(t.Number())
      })
    }
  )
  .post(
    "/ats/blueprint",
    async ({ body, set }) => {
      const snapshot = GitHubProfileSnapshotSchema.parse(body.snapshot);
      const jobSpec = body.jobSpec
        ? JobSpecSchema.parse(body.jobSpec)
        : new ResumeService(new DeepSeekResumeProvider({ apiKey: body.deepseekApiKey })).parseJobText(
            body.jobText
          );
      const analyzer = new AiAtsAnalyzer({ apiKey: body.deepseekApiKey });
      const result = await analyzer.analyzeProfileForJob({
        jobSpec,
        jobFullText: body.jobText,
        profileSnapshot: snapshot,
        profilePrompt: body.profilePrompt,
        resumeRepoNames: body.resumeRepoNames,
        existingBlueprint: body.existingBlueprint
          ? AtsBlueprintSchema.parse(body.existingBlueprint)
          : undefined
      });
      return result;
    },
    {
      body: t.Object({
        deepseekApiKey: t.String(),
        jobText: t.String(),
        jobSpec: t.Optional(t.Unknown()),
        snapshot: t.Unknown(),
        profilePrompt: t.Optional(t.String()),
        resumeRepoNames: t.Optional(t.Array(t.String())),
        existingBlueprint: t.Optional(t.Unknown())
      })
    }
  )
  .post(
    "/resume/generate",
    async ({ body }) => {
      const snapshot = GitHubProfileSnapshotSchema.parse(body.snapshot);
      const jobSpec = body.jobSpec
        ? JobSpecSchema.parse(body.jobSpec)
        : new ResumeService(new DeepSeekResumeProvider({ apiKey: body.deepseekApiKey })).parseJobText(
            body.jobText ?? ""
          );
      const provider = new DeepSeekResumeProvider({ apiKey: body.deepseekApiKey });
      const resumeService = new ResumeService(provider);

      return createSseStream(async (send) => {
        const resume = await resumeService.streamResume(
          {
            jobSpec,
            profileSnapshot: snapshot,
            profilePrompt: body.profilePrompt,
            customRules: body.customRules,
            resumeRepoNames: body.resumeRepoNames,
            locale: body.locale ?? "pt-BR"
          },
          (chunk: string) => send("chunk", { markdown: chunk })
        );
        send("result", { resume });
      });
    },
    {
      body: t.Object({
        deepseekApiKey: t.String(),
        snapshot: t.Unknown(),
        jobText: t.Optional(t.String()),
        jobSpec: t.Optional(t.Unknown()),
        profilePrompt: t.Optional(t.String()),
        customRules: t.Optional(t.String()),
        resumeRepoNames: t.Optional(t.Array(t.String())),
        locale: t.Optional(t.String())
      })
    }
  )
  .post(
    "/resume/weave",
    async ({ body }) => {
      const snapshot = GitHubProfileSnapshotSchema.parse(body.snapshot);
      const jobSpec = JobSpecSchema.parse(body.jobSpec);
      const provider = new DeepSeekResumeProvider({ apiKey: body.deepseekApiKey });
      const resumeService = new ResumeService(provider);

      return createSseStream(async (send) => {
        const markdown = await resumeService.weaveMissingAtsKeywords(
          {
            resumeMarkdown: body.resumeMarkdown,
            missingKeywords: body.missingKeywords,
            profileSnapshot: snapshot,
            profilePrompt: body.profilePrompt,
            customRules: body.customRules,
            resumeRepoNames: body.resumeRepoNames,
            locale: body.locale ?? "pt-BR",
            evidenceHints: body.evidenceHints
          },
          (chunk: string) => send("chunk", { markdown: chunk })
        );
        send("result", { markdown });
      });
    },
    {
      body: t.Object({
        deepseekApiKey: t.String(),
        snapshot: t.Unknown(),
        jobSpec: t.Unknown(),
        resumeMarkdown: t.String(),
        missingKeywords: t.Array(t.String()),
        profilePrompt: t.Optional(t.String()),
        customRules: t.Optional(t.String()),
        resumeRepoNames: t.Optional(t.Array(t.String())),
        evidenceHints: t.Optional(t.Array(t.String())),
        locale: t.Optional(t.String())
      })
    }
  )
  .post(
    "/resume/polish",
    async ({ body }) => {
      const snapshot = GitHubProfileSnapshotSchema.parse(body.snapshot);
      const jobSpec = JobSpecSchema.parse(body.jobSpec);
      const provider = new DeepSeekResumeProvider({ apiKey: body.deepseekApiKey });
      const resumeService = new ResumeService(provider);

      return createSseStream(async (send) => {
        const markdown = await resumeService.polishResumeQuality(
          {
            resumeMarkdown: body.resumeMarkdown,
            profileSnapshot: snapshot,
            jobSpec,
            profilePrompt: body.profilePrompt,
            customRules: body.customRules,
            resumeRepoNames: body.resumeRepoNames,
            locale: body.locale ?? "pt-BR",
            qualityReport: body.qualityReport
          },
          (chunk: string) => send("chunk", { markdown: chunk })
        );
        send("result", { markdown });
      });
    },
    {
      body: t.Object({
        deepseekApiKey: t.String(),
        snapshot: t.Unknown(),
        jobSpec: t.Unknown(),
        resumeMarkdown: t.String(),
        qualityReport: t.Object({
          weakBullets: t.Array(t.String()),
          metricPct: t.Number(),
          suggestions: t.Array(t.String())
        }),
        profilePrompt: t.Optional(t.String()),
        customRules: t.Optional(t.String()),
        resumeRepoNames: t.Optional(t.Array(t.String())),
        locale: t.Optional(t.String())
      })
    }
  )
  .post(
    "/resume/evaluate",
    async ({ body }) => {
      const snapshot = GitHubProfileSnapshotSchema.parse(body.snapshot);
      const jobSpec = JobSpecSchema.parse(body.jobSpec);
      const analyzer = new AiAtsAnalyzer({ apiKey: body.deepseekApiKey });
      const ats = await analyzer.evaluateResumeAgainstBlueprint({
        jobSpec,
        jobFullText: body.jobFullText,
        profileSnapshot: snapshot,
        profilePrompt: body.profilePrompt,
        resumeRepoNames: body.resumeRepoNames,
        resumeMarkdown: body.resumeMarkdown,
        coverLetterMarkdown: body.coverLetterMarkdown,
        blueprint: AtsBlueprintSchema.parse(body.blueprint)
      });
      const qualityReport = analyzeResumeQuality(body.resumeMarkdown, {
        jobSpec,
        jobFullText: body.jobFullText
      });
      return { ats, qualityReport };
    },
    {
      body: t.Object({
        deepseekApiKey: t.String(),
        snapshot: t.Unknown(),
        jobSpec: t.Unknown(),
        jobFullText: t.String(),
        resumeMarkdown: t.String(),
        blueprint: t.Unknown(),
        profilePrompt: t.Optional(t.String()),
        resumeRepoNames: t.Optional(t.Array(t.String())),
        coverLetterMarkdown: t.Optional(t.String())
      })
    }
  )
  .post(
    "/cover-letter/generate",
    async ({ body }) => {
      const snapshot = GitHubProfileSnapshotSchema.parse(body.snapshot);
      const jobSpec = body.jobSpec
        ? JobSpecSchema.parse(body.jobSpec)
        : new ResumeService(new DeepSeekResumeProvider({ apiKey: body.deepseekApiKey })).parseJobText(
            body.jobText ?? ""
          );
      const coverLetterService = new CoverLetterService();

      return createSseStream(async (send) => {
        const letter = await coverLetterService.generateStream(
          {
            jobSpec,
            profileSnapshot: snapshot,
            deepseekApiKey: body.deepseekApiKey,
            profilePrompt: body.profilePrompt,
            customRules: body.customRules,
            resumeRepoNames: body.resumeRepoNames,
            resumeMarkdown: body.resumeMarkdown,
            regenerateNotes: body.regenerateNotes,
            locale: body.locale ?? "pt-BR"
          },
          (chunk: string) => send("chunk", { markdown: chunk })
        );
        send("result", { markdown: letter });
      });
    },
    {
      body: t.Object({
        deepseekApiKey: t.String(),
        snapshot: t.Unknown(),
        jobText: t.Optional(t.String()),
        jobSpec: t.Optional(t.Unknown()),
        profilePrompt: t.Optional(t.String()),
        customRules: t.Optional(t.String()),
        resumeRepoNames: t.Optional(t.Array(t.String())),
        resumeMarkdown: t.Optional(t.String()),
        regenerateNotes: t.Optional(t.String()),
        locale: t.Optional(t.String())
      })
    }
  )
  .post(
    "/pdf/render",
    async ({ body, set }) => {
      const provider = new DeepSeekResumeProvider({ apiKey: body.deepseekApiKey || "unused" });
      const resumeService = new ResumeService(provider);
      const blob = await resumeService.exportMarkdownPdf(body.markdown, body.metadata);
      const buffer = await blob.arrayBuffer();
      const base64 = Buffer.from(buffer).toString("base64");
      set.headers["Content-Type"] = "application/json";
      return { base64, mimeType: "application/pdf" };
    },
    {
      body: t.Object({
        markdown: t.String(),
        deepseekApiKey: t.Optional(t.String()),
        metadata: t.Optional(
          t.Object({
            title: t.Optional(t.String()),
            author: t.Optional(t.String()),
            creator: t.Optional(t.String()),
            keywords: t.Optional(t.String()),
            description: t.Optional(t.String())
          })
        )
      })
    }
  )
  .post(
    "/job/parse",
    ({ body }) => {
      const provider = new DeepSeekResumeProvider({ apiKey: "unused" });
      const jobSpec = new ResumeService(provider).parseJobText(body.jobText);
      return { jobSpec };
    },
    { body: t.Object({ jobText: t.String() }) }
  );
