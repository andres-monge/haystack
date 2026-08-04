// src/server/timezone.ts — Timezone utilities

export interface LocalTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

/** Read local calendar/time fields for an absolute instant in an IANA timezone. */
export function getLocalTimeInTimezone(
  date: Date,
  timezone: string,
): LocalTimeParts {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const values = new Map(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, parseInt(part.value, 10)]),
  );

  return {
    year: values.get("year")!,
    month: values.get("month")!,
    day: values.get("day")!,
    hour: values.get("hour")!,
    minute: values.get("minute")!,
  };
}

/** Get the current hour (0–23) in the given IANA timezone. */
export function getCurrentHourInTimezone(
  timezone: string,
  date: Date = new Date(),
): number {
  return getLocalTimeInTimezone(date, timezone).hour;
}

/**
 * Resolve a local wall-clock hour on the reference date to an absolute instant.
 * The iterative correction avoids parsing a timezone-less string in the host TZ.
 */
export function getInstantForHourInTimezone(
  reference: Date,
  hour: number,
  minute: number,
  timezone: string,
): Date {
  const localDate = getLocalTimeInTimezone(reference, timezone);
  const targetAsUtc = Date.UTC(
    localDate.year,
    localDate.month - 1,
    localDate.day,
    hour,
    minute,
  );
  let instantMs = targetAsUtc;

  for (let i = 0; i < 3; i++) {
    const actual = getLocalTimeInTimezone(new Date(instantMs), timezone);
    const actualAsUtc = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
    );
    const correction = targetAsUtc - actualAsUtc;
    instantMs += correction;
    if (correction === 0) break;
  }

  const instant = new Date(instantMs);
  const resolved = getLocalTimeInTimezone(instant, timezone);
  if (
    resolved.year !== localDate.year
    || resolved.month !== localDate.month
    || resolved.day !== localDate.day
    || resolved.hour !== hour
    || resolved.minute !== minute
  ) {
    const localTime = `${localDate.year}-${String(localDate.month).padStart(2, "0")}-${String(localDate.day).padStart(2, "0")} ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    throw new RangeError(
      `Local time ${localTime} does not exist in timezone ${timezone}`,
    );
  }

  return instant;
}
