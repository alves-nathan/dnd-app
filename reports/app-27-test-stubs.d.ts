declare function describe(name: string, callback: () => void): void;
declare function it(name: string, callback: () => void): void;
declare function expect(value: any): { toBe(expected: any): void; toThrow(expected?: any): void; toBeTruthy(): void };
declare class Buffer { static from(value: string | ArrayBuffer | Uint8Array): Buffer; toString(encoding?: string): string; }
interface JsonWebKey { kty?: string; crv?: string; x?: string; y?: string; d?: string; [key: string]: unknown; }
declare module 'node:crypto' {
  export function generateKeyPairSync(type: string, options: any): { publicKey: { export(options: any): unknown }; privateKey: { export(options: any): unknown } };
  export function createPrivateKey(options: any): any;
  export function sign(algorithm: string, data: Buffer, options: any): Buffer;
}
