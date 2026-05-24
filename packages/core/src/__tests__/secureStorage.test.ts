import { describe, expect, it } from "vitest";

import { SecureStorage } from "../storage/secureStorage";

describe("SecureStorage", () => {
  it("criptografa e decriptografa segredo", async () => {
    const service = new SecureStorage();

    const encrypted = await service.encryptSecret("super-secret", "passphrase-1");
    const decrypted = await service.decryptSecret(encrypted, "passphrase-1");

    expect(decrypted).toBe("super-secret");
  });

  it("falha ao decriptografar com senha incorreta", async () => {
    const service = new SecureStorage();

    const encrypted = await service.encryptSecret("super-secret", "passphrase-1");

    await expect(service.decryptSecret(encrypted, "outra-senha")).rejects.toThrow();
  });
});