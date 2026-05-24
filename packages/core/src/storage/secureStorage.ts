import { EncryptedSecretSchema, type EncryptedSecret } from "../schemas";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const toBase64 = (input: Uint8Array): string => {
  if (typeof btoa === "function") {
    let binary = "";
    for (const value of input) {
      binary += String.fromCharCode(value);
    }
    return btoa(binary);
  }

  return Buffer.from(input).toString("base64");
};

const fromBase64 = (value: string): Uint8Array => {
  if (typeof atob === "function") {
    const binary = atob(value);
    const output = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      output[index] = binary.charCodeAt(index);
    }
    return output;
  }

  return new Uint8Array(Buffer.from(value, "base64"));
};

const subtle = (): SubtleCrypto => {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.subtle) {
    throw new Error("WebCrypto nao disponivel no ambiente atual.");
  }
  return cryptoApi.subtle;
};

const toBufferSource = (value: Uint8Array): ArrayBuffer => {
  const copy = Uint8Array.from(value);
  return copy.buffer as ArrayBuffer;
};

export class SecureStorage {
  private readonly iterations: number;

  constructor(iterations = 150_000) {
    this.iterations = iterations;
  }

  async encryptSecret(secret: string, passphrase: string): Promise<EncryptedSecret> {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));

    const key = await this.deriveKey(passphrase, salt);
    const cipherBuffer = await subtle().encrypt(
      {
        name: "AES-GCM",
        iv: toBufferSource(iv)
      },
      key,
      toBufferSource(encoder.encode(secret))
    );

    return EncryptedSecretSchema.parse({
      cipherText: toBase64(new Uint8Array(cipherBuffer)),
      iv: toBase64(iv),
      salt: toBase64(salt),
      iterations: this.iterations,
      algorithm: "AES-GCM"
    });
  }

  async decryptSecret(payload: EncryptedSecret, passphrase: string): Promise<string> {
    const parsed = EncryptedSecretSchema.parse(payload);
    const salt = fromBase64(parsed.salt);
    const iv = fromBase64(parsed.iv);
    const cipherText = fromBase64(parsed.cipherText);

    const key = await this.deriveKey(passphrase, salt, parsed.iterations);

    const plainBuffer = await subtle().decrypt(
      {
        name: "AES-GCM",
        iv: toBufferSource(iv)
      },
      key,
      toBufferSource(cipherText)
    );

    return decoder.decode(plainBuffer);
  }

  private async deriveKey(
    passphrase: string,
    salt: Uint8Array,
    iterations = this.iterations
  ): Promise<CryptoKey> {
    const keyMaterial = await subtle().importKey(
      "raw",
      encoder.encode(passphrase),
      "PBKDF2",
      false,
      ["deriveKey"]
    );

    return subtle().deriveKey(
      {
        name: "PBKDF2",
        salt: toBufferSource(salt),
        iterations,
        hash: "SHA-256"
      },
      keyMaterial,
      {
        name: "AES-GCM",
        length: 256
      },
      false,
      ["encrypt", "decrypt"]
    );
  }
}
