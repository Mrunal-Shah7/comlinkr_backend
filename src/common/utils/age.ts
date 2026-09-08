// SPRINT-57: age is always derived from dateOfBirth so it can never go stale in storage.
export function computeAge(
  dateOfBirth: Date | null | undefined,
): number | null {
  if (!dateOfBirth) return null;
  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) return null;

  const now = new Date();
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const monthDiff = now.getUTCMonth() - dob.getUTCMonth();
  if (
    monthDiff < 0 ||
    (monthDiff === 0 && now.getUTCDate() < dob.getUTCDate())
  ) {
    age -= 1;
  }
  return age >= 0 && age <= 120 ? age : null;
}
