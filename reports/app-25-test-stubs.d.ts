declare function describe(name: string, callback: () => void): void;
declare function it(name: string, callback: () => void): void;
declare function expect(value: any): { toBe(expected: any): void; toThrow(): void };
