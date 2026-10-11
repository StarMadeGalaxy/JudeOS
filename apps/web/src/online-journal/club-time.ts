const formatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Minsk",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
export function canonicalUTC(value: string): string | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?Z$/.exec(
    value,
  );
  if (!match) return null;
  const date = new Date(`${match[1]}Z`);
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 19) !== match[1]
  )
    return null;
  return `${match[1]}.${match[2]?.replace(/0+$/, "") || "0"}Z`;
}
export function compareUTC(first: string, second: string): number | null {
  const a = canonicalUTC(first),
    b = canonicalUTC(second);
  if (!a || !b) return null;
  const seconds = a.slice(0, 19).localeCompare(b.slice(0, 19));
  if (seconds) return seconds;
  const fractionA = a.slice(20, -1),
    fractionB = b.slice(20, -1);
  const length = Math.max(fractionA.length, fractionB.length);
  return fractionA
    .padEnd(length, "0")
    .localeCompare(fractionB.padEnd(length, "0"));
}
export function localDateTimeInClub(utc: string) {
  const parts = Object.fromEntries(
    formatter
      .formatToParts(new Date(utc))
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}
// Invert the club time zone and round-trip it, independent of the browser zone.
// Invalid calendar dates and nonexistent local times are rejected, not normalized.
export function clubLocalToUTC(
  local: string,
  original?: string,
): string | null {
  if (original && localDateTimeInClub(original) === local) return original;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return null;
  const wall = Date.parse(`${local}:00Z`);
  if (
    !Number.isFinite(wall) ||
    new Date(wall).toISOString().slice(0, 16) !== local
  )
    return null;
  let instant = wall;
  for (let i = 0; i < 3; i++) {
    const rendered = Date.parse(
      `${localDateTimeInClub(new Date(instant).toISOString())}:00Z`,
    );
    instant += wall - rendered;
  }
  const utc = new Date(instant).toISOString();
  return localDateTimeInClub(utc) === local ? utc : null;
}
