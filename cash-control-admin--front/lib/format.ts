export const money = (value: number) => new Intl.NumberFormat("es-CO", {
  style: "currency", currency: "COP", maximumFractionDigits: 0,
}).format(value);

export function todayInBogota(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const value = (part: string) => parts.find(item => item.type === part)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function firstDayAfter(period: string | null): string | null {
  if (!period) return null;
  return new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 1))
    .toISOString().slice(0, 10);
}

export function periodLabel(period: string): string {
  return new Intl.DateTimeFormat("es-CO", { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${period}-01T12:00:00Z`));
}
