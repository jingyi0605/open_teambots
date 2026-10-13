const dateFormat = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });

export function formatDate(date: string) {
  return dateFormat.format(new Date(`${date}T00:00:00Z`));
}

/** Noon UTC keeps the calendar date the same in every timezone that reads it. */
export function isoTimestamp(date: string) {
  return `${date}T12:00:00Z`;
}
