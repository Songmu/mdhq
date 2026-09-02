const RFC3339_DATE = /^(\d{4})-(\d{2})-(\d{2})$/u;
const RFC3339_DATE_TIME =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|([+-])(\d{2}):(\d{2}))$/iu;
const IMF_FIXDATE =
  /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat), (\d{2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4}) (\d{2}):(\d{2}):(\d{2}) GMT$/u;
const RFC850_DATE =
  /^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday), (\d{2})-(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-(\d{2}) (\d{2}):(\d{2}):(\d{2}) GMT$/u;
const ASCTIME_DATE =
  /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) {1,2}(\d{1,2}) (\d{2}):(\d{2}):(\d{2}) (\d{4})$/u;

const MONTHS = new Map(
  ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].map(
    (month, index) => [month, index + 1]
  )
);
const SHORT_WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const LONG_WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday"
];

function capture(match: RegExpExecArray, index: number): string {
  const value = match[index];
  if (value === undefined) {
    throw new TypeError(`Missing regular expression capture ${index}`);
  }
  return value;
}

function leapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function validCalendarDate(year: number, month: number, day: number): boolean {
  const days = [31, leapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= (days[month - 1] ?? 0);
}

function validTime(hour: number, minute: number, second: number): boolean {
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 && second >= 0 && second <= 59;
}

function utcTimestamp(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number
): number {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, 0);
  return date.getTime();
}

function validWeekday(timestamp: number, value: string, long: boolean): boolean {
  const expected = (long ? LONG_WEEKDAYS : SHORT_WEEKDAYS)[new Date(timestamp).getUTCDay()];
  return value === expected;
}

function parseRfc3339(value: string): number | undefined {
  const match = RFC3339_DATE_TIME.exec(value);
  if (!match) {
    return undefined;
  }
  const yearValue = capture(match, 1);
  const monthValue = capture(match, 2);
  const dayValue = capture(match, 3);
  const hourValue = capture(match, 4);
  const minuteValue = capture(match, 5);
  const secondValue = capture(match, 6);
  const zone = capture(match, 7);
  const year = Number(yearValue);
  const month = Number(monthValue);
  const day = Number(dayValue);
  const hour = Number(hourValue);
  const minute = Number(minuteValue);
  const second = Number(secondValue);
  if (!validCalendarDate(year, month, day) || !validTime(hour, minute, second)) {
    return undefined;
  }
  let offsetMinutes = 0;
  if (zone.toUpperCase() !== "Z") {
    const offsetSign = capture(match, 8);
    const offsetHour = Number(capture(match, 9));
    const offsetMinute = Number(capture(match, 10));
    if (offsetHour > 23 || offsetMinute > 59) {
      return undefined;
    }
    offsetMinutes = (offsetHour * 60 + offsetMinute) * (offsetSign === "+" ? 1 : -1);
  }
  return utcTimestamp(year, month, day, hour, minute, second) - offsetMinutes * 60_000;
}

function parseHttpDate(value: string, now: Date): number | undefined {
  const imf = IMF_FIXDATE.exec(value);
  if (imf) {
    const weekday = capture(imf, 1);
    const dayValue = capture(imf, 2);
    const monthName = capture(imf, 3);
    const yearValue = capture(imf, 4);
    const hourValue = capture(imf, 5);
    const minuteValue = capture(imf, 6);
    const secondValue = capture(imf, 7);
    const month = MONTHS.get(monthName) ?? 0;
    const values = [
      Number(yearValue),
      month,
      Number(dayValue),
      Number(hourValue),
      Number(minuteValue),
      Number(secondValue)
    ] as const;
    if (!validCalendarDate(values[0], values[1], values[2]) || !validTime(values[3], values[4], values[5])) {
      return undefined;
    }
    const timestamp = utcTimestamp(...values);
    return validWeekday(timestamp, weekday, false) ? timestamp : undefined;
  }
  const rfc850 = RFC850_DATE.exec(value);
  if (rfc850) {
    const weekday = capture(rfc850, 1);
    const dayValue = capture(rfc850, 2);
    const monthName = capture(rfc850, 3);
    const shortYearValue = capture(rfc850, 4);
    const hourValue = capture(rfc850, 5);
    const minuteValue = capture(rfc850, 6);
    const secondValue = capture(rfc850, 7);
    const month = MONTHS.get(monthName) ?? 0;
    const currentYear = now.getUTCFullYear();
    let year = Math.floor(currentYear / 100) * 100 + Number(shortYearValue);
    const candidateValues = [
      year,
      month,
      Number(dayValue),
      Number(hourValue),
      Number(minuteValue),
      Number(secondValue)
    ] as const;
    if (
      !validCalendarDate(candidateValues[0], candidateValues[1], candidateValues[2]) ||
      !validTime(candidateValues[3], candidateValues[4], candidateValues[5])
    ) {
      return undefined;
    }
    const cutoff = new Date(now.getTime());
    cutoff.setUTCFullYear(cutoff.getUTCFullYear() + 50);
    if (utcTimestamp(...candidateValues) > cutoff.getTime()) {
      year -= 100;
    }
    const values = [
      year,
      month,
      Number(dayValue),
      Number(hourValue),
      Number(minuteValue),
      Number(secondValue)
    ] as const;
    const timestamp = utcTimestamp(...values);
    return validWeekday(timestamp, weekday, true) ? timestamp : undefined;
  }
  const asctime = ASCTIME_DATE.exec(value);
  if (!asctime) {
    return undefined;
  }
  const weekday = capture(asctime, 1);
  const monthName = capture(asctime, 2);
  const dayValue = capture(asctime, 3);
  const hourValue = capture(asctime, 4);
  const minuteValue = capture(asctime, 5);
  const secondValue = capture(asctime, 6);
  const yearValue = capture(asctime, 7);
  const month = MONTHS.get(monthName) ?? 0;
  const values = [
    Number(yearValue),
    month,
    Number(dayValue),
    Number(hourValue),
    Number(minuteValue),
    Number(secondValue)
  ] as const;
  if (!validCalendarDate(values[0], values[1], values[2]) || !validTime(values[3], values[4], values[5])) {
    return undefined;
  }
  const timestamp = utcTimestamp(...values);
  return validWeekday(timestamp, weekday, false) ? timestamp : undefined;
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
  const dateMatch = RFC3339_DATE.exec(trimmed);
  if (dateMatch) {
    return validCalendarDate(
      Number(dateMatch[1]),
      Number(dateMatch[2]),
      Number(dateMatch[3])
    )
      ? trimmed
      : undefined;
  }
  const match = RFC3339_DATE_TIME.exec(trimmed);
  if (!match || parseRfc3339(trimmed) === undefined) {
    return undefined;
  }
  const zone =
    match[7]?.toUpperCase() === "Z"
      ? "Z"
      : `${match[8]}${match[9]}:${match[10]}`;
  return `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}${zone}`;
}

export function isRfc3339DateTime(value: string | undefined): value is string {
  return value !== undefined && parseRfc3339(value) !== undefined;
}

export function httpDateToRfc3339(
  value: string | undefined,
  now = new Date()
): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  const timestamp = parseHttpDate(trimmed, now);
  if (timestamp === undefined) {
    return undefined;
  }
  return new Date(timestamp).toISOString().replace(".000Z", "Z");
}

export function rfc3339ToHttpDate(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const timestamp = parseRfc3339(value);
  return timestamp === undefined ? undefined : new Date(timestamp).toUTCString();
}
