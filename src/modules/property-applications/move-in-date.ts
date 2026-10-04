export type DateFormatRegion = 'US' | 'UK';

/**
 * Mirrors the mobile app's market heuristic (housing screen): a listing is UK
 * when its address mentions London, UK or Manchester or it is priced in GBP;
 * everything else is US. The app shows DD/MM/YYYY for UK and MM/DD/YYYY for US,
 * so both sides must agree or day/month would be silently swapped.
 */
export function regionForListing(listing: {
  address: string | null | undefined;
  currency: string | null | undefined;
}): DateFormatRegion {
  const address = listing.address ?? '';
  const isUK =
    address.includes('London') ||
    address.includes('UK') ||
    address.includes('Manchester') ||
    (listing.currency ?? '').toUpperCase() === 'GBP';
  return isUK ? 'UK' : 'US';
}

function buildUtcDate(year: number, month: number, day: number): Date | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  // Rejects overflow such as 31/02 rolling into March.
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

/**
 * Parses YYYY-MM-DD (or a full ISO timestamp) and the app's display formats.
 * Slash dates are read as MM/DD/YYYY for US and DD/MM/YYYY for UK.
 * Returns null when the value is not a real calendar date.
 */
export function parseMoveInDate(
  value: string,
  region: DateFormatRegion,
): Date | null {
  const trimmed = value.trim();

  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/.exec(trimmed);
  if (iso) {
    return buildUtcDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  }

  const display = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(trimmed);
  if (display) {
    const first = Number(display[1]);
    const second = Number(display[2]);
    const year = Number(display[3]);
    return region === 'US'
      ? buildUtcDate(year, first, second)
      : buildUtcDate(year, second, first);
  }

  return null;
}
