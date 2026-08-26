export type AdminVerificationStatus = 'pending' | 'approved' | 'rejected';

export type AdminStatusFilter = 'all' | AdminVerificationStatus;

export type AdminCompletenessState = 'complete' | 'incomplete';

export interface AdminSummary {
  pending: number;
  approved: number;
  rejected: number;
}

export interface DietitianApplication {
  userId: string;
  fullName: string | null;
  email: string | null;
  createdAt: string | null;
  university: string | null;
  specialization: string | null;
  experienceYears: number | null;
  verificationStatus: AdminVerificationStatus;
  completenessState: AdminCompletenessState;
}

export interface DietitianApplicationDetail extends DietitianApplication {
  phone: string | null;
  graduationYear: number | null;
  bio: string | null;
  isVerified: boolean | null;
  verifiedAt: string | null;
  rejectionReason: string | null;
  missingFields: string[];
  diplomaObjectPath: string | null;
}

export interface VerificationHistoryEntry {
  id: string;
  previousStatus: AdminVerificationStatus;
  newStatus: Exclude<AdminVerificationStatus, 'pending'>;
  rejectionReason: string | null;
  decidedBySnapshot: string;
  decidedAt: string;
}

export interface AdminDecisionResult {
  userId: string;
  verificationStatus: AdminVerificationStatus;
  isVerified: boolean | null;
  verifiedAt: string | null;
  rejectionReason: string | null;
  auditId: string | null;
}

export type AdminErrorCode =
  | 'AUTH_REQUIRED'
  | 'NOT_AUTHORIZED'
  | 'ACCESS_CHECK_FAILED'
  | 'INVALID_REQUEST'
  | 'NOT_FOUND'
  | 'INCOMPLETE_APPLICATION'
  | 'INVALID_TRANSITION'
  | 'STORAGE_ACCESS_FAILED'
  | 'INVALID_RESPONSE'
  | 'UNKNOWN';

export class AdminServiceError extends Error {
  constructor(
    public readonly code: AdminErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AdminServiceError';
  }
}
