import { beforeEach, describe, expect, it } from "vitest";

import { BrowserSqliteStorage } from "../storage/sqliteStorage";
import { buildSnapshotFixture } from "./fixtures";

class LocalStorageMock {
  private map = new Map<string, string>();

  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null;
  }

  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }
}

describe("BrowserSqliteStorage", () => {
  beforeEach(() => {
    (globalThis as unknown as { localStorage?: LocalStorageMock }).localStorage =
      new LocalStorageMock();
  });

  it("salva e recupera snapshot", async () => {
    const storage = new BrowserSqliteStorage({ persistKey: "test-sqlite" });

    await storage.init();
    await storage.saveSnapshot(buildSnapshotFixture());
    const latest = await storage.getLatestSnapshot();

    expect(latest?.user.login).toBe("octocat");

    const binary = storage.exportBinary();
    expect(binary.length).toBeGreaterThan(0);
  });
});
