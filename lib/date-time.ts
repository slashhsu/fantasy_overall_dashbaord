import { ValidationError } from "@/lib/errors";

export const isStrictIsoDate = (value: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
};

export const isIanaTimeZone = (value: string) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
    return Boolean(value);
  } catch {
    return false;
  }
};

export const requireIsoDate = (value: string) => {
  if (!isStrictIsoDate(value)) throw new ValidationError("date must be a real calendar date in YYYY-MM-DD format.");
  return value;
};

export const requireTimeZone = (value: string) => {
  if (!isIanaTimeZone(value)) throw new ValidationError("timeZone must be a valid IANA time zone.");
  return value;
};

export const todayInTimeZone = (timeZone: string, date = new Date()) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
};
