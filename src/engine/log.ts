import type { LogCallback } from "./types";

export function emitLog(
  onDetail: LogCallback | undefined,
  functionName: string,
  message: string
): void {
  onDetail?.(functionName, message);
}

export function truncateForLog(text: string, maxLen = 160): string {
  const one = text.replace(/\s+/g, " ").trim();
  if (one.length <= maxLen) {
    return one;
  }
  return one.slice(0, maxLen - 3) + "...";
}

export class StepLogCollector {
  readonly lines: string[] = [];

  asCallback(): LogCallback {
    return (fn, message) => {
      this.lines.push(`[${fn}] ${message}`);
    };
  }

  info(fn: string, message: string): void {
    this.lines.push(`[${fn}] ${message}`);
  }
}
