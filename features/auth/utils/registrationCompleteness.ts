export const DIETITIAN_DIPLOMA_BUCKET = 'dietitian-diplomas';

export const getCanonicalDiplomaPath = (userId: string): string =>
  `diplomas/${userId}/diploma.pdf`;

export const isCanonicalDiplomaPath = (value: unknown, userId: string): boolean =>
  typeof value === 'string' && value === getCanonicalDiplomaPath(userId);

export interface RegistrationCompletenessInput {
  userId: string;
  fullName?: string | null;
  email?: string | null;
  phone?: string | null;
  university?: string | null;
  graduationYear?: number | string | null;
  experienceYears?: number | string | null;
  specialization?: string | null;
  bio?: string | null;
  diplomaUrl?: string | null;
}

export interface RegistrationCompletenessResult {
  isComplete: boolean;
  missingFields: string[];
  canonicalDiplomaPath: string;
}

const hasText = (value: string | null | undefined): boolean =>
  typeof value === 'string' && value.trim().length > 0;

const toFiniteNumber = (value: number | string | null | undefined): number | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && value.trim() === '') return null;

  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * Mirrors the Product Admin persisted-field completeness contract for client UX.
 * Storage object existence remains authoritative in the Product Admin database function.
 */
export const getRegistrationCompleteness = (
  input: RegistrationCompletenessInput,
): RegistrationCompletenessResult => {
  const canonicalDiplomaPath = getCanonicalDiplomaPath(input.userId);
  const missingFields: string[] = [];
  const currentYear = new Date().getFullYear();
  const graduationYear = toFiniteNumber(input.graduationYear);
  const experienceYears = toFiniteNumber(input.experienceYears);

  if (!hasText(input.fullName)) missingFields.push('full_name');
  if (!hasText(input.email)) missingFields.push('email');
  if (!hasText(input.phone)) missingFields.push('phone');
  if (!hasText(input.university)) missingFields.push('university');
  if (
    graduationYear === null
    || !Number.isInteger(graduationYear)
    || graduationYear < 1950
    || graduationYear > currentYear
  ) {
    missingFields.push('graduation_year');
  }
  if (experienceYears === null || experienceYears < 0) missingFields.push('experience_years');
  if (!hasText(input.specialization)) missingFields.push('specialization');
  if (!hasText(input.bio)) missingFields.push('bio');
  if (!isCanonicalDiplomaPath(input.diplomaUrl, input.userId)) missingFields.push('diploma');

  return {
    isComplete: missingFields.length === 0,
    missingFields,
    canonicalDiplomaPath,
  };
};
