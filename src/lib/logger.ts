type LogLevel = "info" | "warn" | "error" | "debug";

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  data?: unknown;
}

function getTimestamp(): string {
  return new Date().toISOString();
}

function formatEntry(level: LogLevel, message: string, data?: unknown): LogEntry {
  return {
    timestamp: getTimestamp(),
    level,
    message,
    ...(data !== undefined ? { data } : {}),
  };
}

function serialize(entry: LogEntry): string {
  return JSON.stringify(entry);
}

function shouldLog(level: LogLevel): boolean {
  if (level === "debug" && process.env.NODE_ENV === "production") {
    return false;
  }
  return true;
}

export const logger = {
  info(message: string, data?: unknown): void {
    if (!shouldLog("info")) return;
    const entry = formatEntry("info", message, data);
    console.log(serialize(entry));
  },

  warn(message: string, data?: unknown): void {
    if (!shouldLog("warn")) return;
    const entry = formatEntry("warn", message, data);
    console.warn(serialize(entry));
  },

  error(message: string, data?: unknown): void {
    if (!shouldLog("error")) return;
    const entry = formatEntry("error", message, data);
    console.error(serialize(entry));
  },

  debug(message: string, data?: unknown): void {
    if (!shouldLog("debug")) return;
    const entry = formatEntry("debug", message, data);
    console.debug(serialize(entry));
  },
};

export default logger;
