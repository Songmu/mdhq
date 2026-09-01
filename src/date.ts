const RFC3339_DATE = /^\d{4}-\d{2}-\d{2}$/u;
const RFC3339_DATE_TIME =
  /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/iu;

function validDate(value: string): boolean {
  return !Number.isNaN(Date.parse(value));
}

export function formatLocalRfc3339(date: Date): string {
  const pad = (value: number, width = 2) => String(value).padStart(width, "0");
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const hours = Math.floor(Math.abs(offsetMinutes) / 60);
  const minutes = Math.abs(offsetMinutes) % 60;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${sign}${pad(hours)}:${pad(minutes)}`;
}

export function normalizeSourceDate(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  if (RFC3339_DATE.test(trimmed)) {
    return validDate(`${trimmed}T00:00:00Z`) ? trimmed : undefined;
  }
  const match = RFC3339_DATE_TIME.exec(trimmed);
  if (!match || !validDate(trimmed)) {
    return undefined;
  }
  const zone = match[3]?.toUpperCase() === "Z" ? "Z" : match[3];
  return `${match[1]}T${match[2]}${zone}`;
}

export function httpDateToRfc3339(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  const timestamp = Date.parse(trimmed);
  if (Number.isNaN(timestamp)) {
    return undefined;
  }
  return new Date(timestamp).toISOString().replace(".000Z", "Z");
}

export function rfc3339ToHttpDate(value: string | undefined): string | undefined {
  if (!value || !RFC3339_DATE_TIME.test(value) || !validDate(value)) {
    return undefined;
  }
  return new Date(value).toUTCString();
}
