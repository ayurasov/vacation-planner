// Типы sync-guide.mjs для теста web/src/guide/sync.spec.ts (vue-tsc проверяет спецификации).
export declare const CONTENT: string;
export declare const GUIDE_NAMES: readonly string[];
export declare function referencedImages(markdown: string): string[];
export declare function pngSize(path: string): [number, number] | null;
export declare function plan(): { files: Array<{ source: string; target: string }>; sizes: Record<string, [number, number]> };
export declare function check(): string[];
export declare function sync(): number;
