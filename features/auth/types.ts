import { DietitianProfile } from '../../shared/types';

export type AuthAccessState =
  | { status: 'initializing' }
  | { status: 'unauthenticated'; message?: string }
  | { status: 'resolving_access'; userId: string }
  | { status: 'allowed'; userRole: 'dietitian'; dietitianProfile: DietitianProfile }
  | { status: 'blocked_client'; userRole: 'client'; message: string }
  | { status: 'blocked_missing_role'; message: string }
  | { status: 'blocked_missing_dietitian_profile'; message: string }
  | { status: 'pending'; userRole: 'dietitian'; dietitianProfile: DietitianProfile }
  | { status: 'rejected'; userRole: 'dietitian'; dietitianProfile: DietitianProfile }
  | { status: 'access_error'; message: string }
  | { status: 'password_recovery' };

export type ResolvedAuthAccess = Exclude<
  AuthAccessState,
  { status: 'initializing' } | { status: 'resolving_access' }
>;

export interface AuthSignInResult {
  success: boolean;
  error?: string;
}
