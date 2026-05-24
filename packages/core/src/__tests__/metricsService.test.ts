import { describe, expect, it } from "vitest";

import { MetricsService } from "../services/metricsService";
import { buildSnapshotFixture } from "./fixtures";

describe("MetricsService", () => {
  const metricsService = new MetricsService();

  it("calcula score alto para vaga aderente", () => {
    const snapshot = buildSnapshotFixture();
    const metrics = metricsService.computeProfileMetrics({
      profileSnapshot: snapshot,
      windowMonths: 24
    });

    const analysis = metricsService.computeAtsScore({
      jobSpec: {
        title: "Frontend Engineer",
        summary: "React TypeScript Tailwind",
        responsibilities: ["Construir interfaces React"],
        requiredSkills: ["react", "typescript"],
        preferredSkills: ["tailwind"],
        keywords: ["react", "typescript", "tailwind"]
      },
      profileMetrics: metrics
    });

    expect(analysis.score).toBeGreaterThanOrEqual(60);
  });

  it("calcula score medio", () => {
    const snapshot = buildSnapshotFixture();
    const metrics = metricsService.computeProfileMetrics({
      profileSnapshot: snapshot,
      windowMonths: 24
    });

    const analysis = metricsService.computeAtsScore({
      jobSpec: {
        title: "Backend Engineer",
        summary: "Python APIs and SQL",
        responsibilities: ["APIs"],
        requiredSkills: ["python", "sql", "docker"],
        preferredSkills: ["kubernetes"],
        keywords: ["python", "sql", "docker"]
      },
      profileMetrics: metrics
    });

    expect(analysis.score).toBeGreaterThanOrEqual(20);
    expect(analysis.score).toBeLessThan(90);
  });

  it("calcula score baixo para vaga distante", () => {
    const snapshot = buildSnapshotFixture();
    const metrics = metricsService.computeProfileMetrics({
      profileSnapshot: snapshot,
      windowMonths: 24
    });

    const analysis = metricsService.computeAtsScore({
      jobSpec: {
        title: "Data Scientist",
        summary: "R, Spark, TensorFlow",
        responsibilities: ["ML"],
        requiredSkills: ["spark", "tensorflow", "r"],
        preferredSkills: ["pytorch"],
        keywords: ["spark", "tensorflow", "pytorch"]
      },
      profileMetrics: metrics
    });

    expect(analysis.score).toBeLessThan(60);
  });
});