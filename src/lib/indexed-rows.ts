import type { IndexedLineKind, ViewRow } from "./agent-diff-index.js";

/** Retains all parsed fields without allocating an object for every source line.
 * The backing arrays are enumerable so snapshot byte accounting includes them.
 * Each line occupies [hunk, kind, old line, new line, original prefixed text]. */
export class IndexedRows implements Iterable<ViewRow> {
  private values: Array<number | string | null>;
  private headers: Record<number, ViewRow> = {};
  private count = 0;

  constructor(capacity: number) {
    this.values = new Array(capacity * 5);
  }

  get length(): number { return this.count; }

  push(row: Exclude<ViewRow, { type: "line" }>): void {
    const offset = this.count * 5;
    this.headers[this.count++] = row;
    for (let i = 0; i < 5; i++) this.values[offset + i] = null;
  }

  pushLine(hunk: number, kind: IndexedLineKind, oldLine: number | null, newLine: number | null, rawText: string): void {
    const offset = this.count++ * 5;
    this.values[offset] = hunk;
    this.values[offset + 1] = kind;
    this.values[offset + 2] = oldLine;
    this.values[offset + 3] = newLine;
    this.values[offset + 4] = rawText;
  }

  finish(): void { this.values.length = this.count * 5; }

  at(index: number): ViewRow | undefined {
    if (index < 0) index += this.count;
    if (!Number.isInteger(index) || index < 0 || index >= this.count) return undefined;
    if (this.headers[index]) return this.headers[index];
    const offset = index * 5;
    return {
      type: "line",
      hunkIndex: this.values[offset] as number,
      kind: this.values[offset + 1] as IndexedLineKind,
      oldLineno: this.values[offset + 2] as number | null,
      newLineno: this.values[offset + 3] as number | null,
      content: (this.values[offset + 4] as string).slice(1),
    };
  }

  lineNumber(index: number, side: "additions" | "deletions"): number | null {
    return this.values[index * 5 + (side === "additions" ? 3 : 2)] as number | null;
  }

  lineContent(index: number): string | undefined {
    const raw = this.values[index * 5 + 4];
    return typeof raw === "string" ? raw.slice(1) : undefined;
  }

  *[Symbol.iterator](): Iterator<ViewRow> {
    for (let i = 0; i < this.count; i++) yield this.at(i)!;
  }
}
