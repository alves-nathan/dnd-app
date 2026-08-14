declare module 'zod' {
  export const z: any;
  export namespace z { type infer<T> = any; }
}
declare function describe(name: string, body: () => void): void;
declare function it(name: string, body: () => void | Promise<void>): void;
declare function expect(value: unknown): any;
