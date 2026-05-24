import { z } from "zod";

export const JobSpecSchema = z.object({
  title: z.string().min(1),
  company: z.string().optional(),
  location: z.string().optional(),
  level: z.string().optional(),
  summary: z.string().min(1),
  responsibilities: z.array(z.string()).default([]),
  requiredSkills: z.array(z.string()).default([]),
  preferredSkills: z.array(z.string()).default([]),
  keywords: z.array(z.string()).default([])
});

export const RepoSnapshotSchema = z.object({
  id: z.number(),
  name: z.string(),
  fullName: z.string(),
  private: z.boolean(),
  description: z.string().nullable(),
  language: z.string().nullable(),
  stargazersCount: z.number().nonnegative(),
  forksCount: z.number().nonnegative(),
  openIssuesCount: z.number().nonnegative(),
  size: z.number().nonnegative(),
  defaultBranch: z.string(),
  updatedAt: z.string(),
  pushedAt: z.string().nullable()
});

export const CommitSnapshotSchema = z.object({
  sha: z.string(),
  repoName: z.string(),
  message: z.string(),
  committedAt: z.string(),
  url: z.string().url().optional()
});

export const PullRequestSnapshotSchema = z.object({
  id: z.number(),
  repoName: z.string(),
  number: z.number(),
  title: z.string(),
  state: z.enum(["open", "closed"]),
  createdAt: z.string(),
  updatedAt: z.string(),
  mergedAt: z.string().nullable(),
  url: z.string().url()
});

export const IssueSnapshotSchema = z.object({
  id: z.number(),
  repoName: z.string(),
  number: z.number(),
  title: z.string(),
  state: z.enum(["open", "closed"]),
  createdAt: z.string(),
  updatedAt: z.string(),
  closedAt: z.string().nullable(),
  url: z.string().url()
});

export const LanguageStatSchema = z.object({
  repoName: z.string(),
  language: z.string(),
  bytes: z.number().nonnegative()
});

export const ActionsSummarySchema = z.object({
  totalRuns: z.number().nonnegative(),
  successRuns: z.number().nonnegative(),
  failedRuns: z.number().nonnegative(),
  cancelledRuns: z.number().nonnegative(),
  mode: z.enum(["limited", "full"]).default("limited")
});

export const GitHubUserSchema = z.object({
  login: z.string(),
  name: z.string().nullable(),
  bio: z.string().nullable(),
  email: z.string().nullable(),
  location: z.string().nullable(),
  followers: z.number().nonnegative(),
  following: z.number().nonnegative(),
  publicRepos: z.number().nonnegative(),
  avatarUrl: z.string().url().optional()
});

export const GitHubProfileSnapshotSchema = z.object({
  capturedAt: z.string(),
  user: GitHubUserSchema,
  repos: z.array(RepoSnapshotSchema),
  commits: z.array(CommitSnapshotSchema),
  pullRequests: z.array(PullRequestSnapshotSchema),
  issues: z.array(IssueSnapshotSchema),
  languages: z.array(LanguageStatSchema),
  actions: ActionsSummarySchema
});

export const ProfileMetricsSchema = z.object({
  windowMonths: z.number().int().positive(),
  consideredFrom: z.string(),
  consideredTo: z.string(),
  totalRepos: z.number().nonnegative(),
  activeRepos: z.number().nonnegative(),
  totalCommits: z.number().nonnegative(),
  totalPullRequests: z.number().nonnegative(),
  mergedPullRequests: z.number().nonnegative(),
  totalIssues: z.number().nonnegative(),
  topLanguages: z.array(
    z.object({
      language: z.string(),
      bytes: z.number().nonnegative(),
      share: z.number().min(0).max(1)
    })
  ),
  highlights: z.array(z.string()),
  skillsEvidence: z.array(z.string())
});

export const AtsAnalysisSchema = z.object({
  score: z.number().min(0).max(100),
  matchedKeywords: z.array(z.string()),
  missingKeywords: z.array(z.string()),
  suggestions: z.array(z.string()),
  evidence: z.array(z.string())
});

export const ResumeSectionSchema = z.object({
  title: z.string(),
  bullets: z.array(z.string()).min(1)
});

export const ProjectEvidenceSchema = z.object({
  repoName: z.string(),
  fullName: z.string(),
  summary: z.string(),
  technologies: z.array(z.string()).default([]),
  architectureSignals: z.array(z.string()).default([]),
  commitCount: z.number().nonnegative(),
  pullRequestCount: z.number().nonnegative(),
  mergedPullRequestCount: z.number().nonnegative(),
  issueCount: z.number().nonnegative(),
  quantifiedImpactSignals: z.array(z.string()).default([]),
  evidence: z.array(z.string()).default([])
});

export const ResumeDocumentSchema = z.object({
  locale: z.string().default("pt-BR"),
  fullName: z.string().min(1),
  headline: z.string().min(1),
  summary: z.string().min(1),
  contact: z.object({
    email: z.string().optional(),
    location: z.string().optional(),
    github: z.string().optional(),
    website: z.string().optional()
  }),
  skills: z.array(z.string()).default([]),
  experience: z.array(ResumeSectionSchema).default([]),
  projects: z.array(ResumeSectionSchema).default([]),
  projectEvidence: z.array(ProjectEvidenceSchema).default([]),
  education: z.array(z.string()).default([]),
  atsKeywords: z.array(z.string()).default([]),
  rawMarkdown: z.string().optional()
});

export const EncryptedSecretSchema = z.object({
  cipherText: z.string(),
  iv: z.string(),
  salt: z.string(),
  iterations: z.number().int().positive(),
  algorithm: z.literal("AES-GCM")
});

export const SettingsSchema = z.object({
  language: z.string().default("pt-BR"),
  atsTarget: z.string().default("global"),
  lastSyncAt: z.string().nullable().default(null),
  githubTokenEncrypted: EncryptedSecretSchema.nullable().default(null),
  deepseekApiKeyEncrypted: EncryptedSecretSchema.nullable().default(null)
});

export type JobSpec = z.infer<typeof JobSpecSchema>;
export type RepoSnapshot = z.infer<typeof RepoSnapshotSchema>;
export type CommitSnapshot = z.infer<typeof CommitSnapshotSchema>;
export type PullRequestSnapshot = z.infer<typeof PullRequestSnapshotSchema>;
export type IssueSnapshot = z.infer<typeof IssueSnapshotSchema>;
export type LanguageStat = z.infer<typeof LanguageStatSchema>;
export type GitHubProfileSnapshot = z.infer<typeof GitHubProfileSnapshotSchema>;
export type ProfileMetrics = z.infer<typeof ProfileMetricsSchema>;
export type AtsAnalysis = z.infer<typeof AtsAnalysisSchema>;
export type ResumeDocument = z.infer<typeof ResumeDocumentSchema>;
export type ProjectEvidence = z.infer<typeof ProjectEvidenceSchema>;
export type Settings = z.infer<typeof SettingsSchema>;
export type EncryptedSecret = z.infer<typeof EncryptedSecretSchema>;
