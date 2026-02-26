// src/server/timezone.ts — Timezone utilities

/** Get the current hour (0–23) in the given IANA timezone. */
export function getCurrentHourInTimezone(timezone: string): number {
  const hourStr = new Date().toLocaleString("en-US", {
    hour: "numeric",
    hourCycle: "h23",
    timeZone: timezone,
  });
  return parseInt(hourStr, 10);
}
