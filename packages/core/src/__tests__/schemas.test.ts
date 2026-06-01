import { describe, expect, it } from "bun:test";

import { JobSpecSchema, ResumeDocumentSchema } from "../schemas";

describe("schemas", () => {
  it("valida JobSpec basico", () => {
    const parsed = JobSpecSchema.parse({
      title: "Frontend Engineer",
      summary: "Build React interfaces",
      responsibilities: ["Entregar features"],
      requiredSkills: ["react", "typescript"],
      preferredSkills: ["zod"],
      keywords: ["react"]
    });

    expect(parsed.title).toBe("Frontend Engineer");
  });

  it("rejeita resume sem fullName", () => {
    expect(() => ResumeDocumentSchema.parse({})).toThrow();
  });
});