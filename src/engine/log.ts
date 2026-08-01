import type { LogCallback, LogLevel } from "./types";

export type { LogLevel };

const LEVELS: LogLevel[] = ["debug", "info", "warn", "error"];

/** Infer a level from message text when callers don't pass one explicitly. */
export function inferLogLevel(message: string): LogLevel {
  const m = message.toLowerCase();
  if (/\b(error|failed|failure|exception|crash)\b/.test(m)) {
    return "error";
  }
  if (
    /\b(warn|warning|unavailable|skipped|unsupported|flagged|incomplete|review manually)\b/.test(
      m
    )
  ) {
    return "warn";
  }
  // Indented detail lines from nested transform steps
  if (/^\s{2,}/.test(message) || /^->\s/.test(message.trim())) {
    return "debug";
  }
  return "info";
}

export function formatStepLogLine(
  level: LogLevel,
  functionName: string,
  message: string
): string {
  return `[${level.toUpperCase()}] [${functionName}] ${message}`;
}

export interface ParsedStepLogLine {
  level: LogLevel;
  functionName: string;
  message: string;
  raw: string;
}

/**
 * Parse a step-log line. Supports:
 *   [INFO] [fn] message          (current)
 *   [fn] message                 (legacy)
 */
export function parseStepLogLine(raw: string): ParsedStepLogLine {
  const modern =
    /^\[(DEBUG|INFO|WARN|WARNING|ERROR)\]\s+\[([^\]]+)\]\s*(.*)$/i.exec(raw);
  if (modern) {
    const token = modern[1].toLowerCase();
    const level: LogLevel =
      token === "warning" ? "warn" : LEVELS.includes(token as LogLevel)
        ? (token as LogLevel)
        : "info";
    return {
      level,
      functionName: modern[2],
      message: modern[3],
      raw,
    };
  }
  const legacy = /^\[([^\]]+)\]\s*(.*)$/.exec(raw);
  if (legacy) {
    const message = legacy[2];
    return {
      level: inferLogLevel(message),
      functionName: legacy[1],
      message,
      raw,
    };
  }
  return {
    level: inferLogLevel(raw),
    functionName: "—",
    message: raw,
    raw,
  };
}

export function emitLog(
  onDetail: LogCallback | undefined,
  functionName: string,
  message: string,
  level?: LogLevel
): void {
  onDetail?.(functionName, message, level ?? inferLogLevel(message));
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
    return (fn, message, level) => {
      this.push(level ?? inferLogLevel(message), fn, message);
    };
  }

  push(level: LogLevel, fn: string, message: string): void {
    this.lines.push(formatStepLogLine(level, fn, message));
  }

  info(fn: string, message: string): void {
    this.push("info", fn, message);
  }

  debug(fn: string, message: string): void {
    this.push("debug", fn, message);
  }

  warn(fn: string, message: string): void {
    this.push("warn", fn, message);
  }

  error(fn: string, message: string): void {
    this.push("error", fn, message);
  }
}
