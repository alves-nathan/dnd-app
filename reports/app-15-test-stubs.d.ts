declare function describe(name: string, fn: () => void): void;
declare function it(name: string, fn: () => void | Promise<void>): void;
declare function expect<T>(value: T): {
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
  toBeDefined(): void;
  toBeTruthy(): void;
  toBeFalsy(): void;
};
