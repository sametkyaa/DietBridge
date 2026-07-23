import React, { createContext, useCallback, useContext, useEffect, useRef, useState, PropsWithChildren } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '../../../lib/supabaseClient';
import { DietitianProfile } from '../../../shared/types';
import { AuthAccessState, AuthSignInResult } from '../types';
import { getSafeAuthErrorMessage, resolveAuthAccess } from '../services/authService';
import { getAuthLifecycleAction } from '../services/authLifecycle';

interface AuthContextType {
  session: Session | null;
  user: User | null;
  userRole: string | null;
  dietitianProfile: DietitianProfile | null;
  accessState: AuthAccessState;
  loading: boolean;
  isInitialLoading: boolean;
  isRefreshingSession: boolean;
  authError: string | null;
  signIn: (email: string, password: string) => Promise<AuthSignInResult>;
  signOut: (message?: string) => Promise<void>;
  refreshAccess: () => Promise<void>;
}

const initialAccessState: AuthAccessState = { status: 'initializing' };

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  userRole: null,
  dietitianProfile: null,
  accessState: initialAccessState,
  loading: true,
  isInitialLoading: true,
  isRefreshingSession: false,
  authError: null,
  signIn: async () => ({ success: false, error: 'Kimlik doğrulama kullanılamıyor.' }),
  signOut: async () => {},
  refreshAccess: async () => {},
});

export const AuthProvider = ({ children }: PropsWithChildren) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [dietitianProfile, setDietitianProfile] = useState<DietitianProfile | null>(null);
  const [accessState, setAccessState] = useState<AuthAccessState>(initialAccessState);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isRefreshingSession, setIsRefreshingSession] = useState(false);
  const requestVersion = useRef(0);
  const mounted = useRef(true);
  const sessionRef = useRef<Session | null>(null);
  const accessResolvedRef = useRef(false);
  const pendingSignOutMessage = useRef<string | undefined>(undefined);

  const clearAccessState = useCallback((message?: string) => {
    if (!mounted.current) return;
    setSession(null);
    setUser(null);
    sessionRef.current = null;
    accessResolvedRef.current = true;
    setUserRole(null);
    setDietitianProfile(null);
    setAuthError(message || null);
    setAccessState({ status: 'unauthenticated', ...(message ? { message } : {}) });
    setIsInitialLoading(false);
    setIsRefreshingSession(false);
  }, []);

  const signOut = useCallback(async (message?: string) => {
    requestVersion.current += 1;
    const requestedMessage = message || pendingSignOutMessage.current;
    pendingSignOutMessage.current = requestedMessage;
    const { error } = await supabase.auth.signOut();

    if (error) {
      const safeMessage = 'Oturum kapatılırken bir hata oluştu. Lütfen tekrar deneyin.';
      pendingSignOutMessage.current = undefined;
      if (mounted.current) setAuthError(safeMessage);
      console.error('Auth sign-out error:', error);
      return;
    }

    const signOutMessage = requestedMessage || pendingSignOutMessage.current;
    pendingSignOutMessage.current = undefined;
    clearAccessState(signOutMessage);
  }, [clearAccessState]);

  const updateSessionOnly = useCallback((nextSession: Session) => {
    sessionRef.current = nextSession;
    if (!mounted.current) return;
    setSession(nextSession);
    setUser(nextSession.user);
  }, []);

  const resolveSession = useCallback(async (nextSession: Session | null, force = false) => {
    const nextUserId = nextSession?.user.id ?? null;
    const currentUserId = sessionRef.current?.user.id ?? null;
    if (!force && nextUserId && currentUserId === nextUserId && accessResolvedRef.current) {
      updateSessionOnly(nextSession);
      return;
    }

    const requestId = ++requestVersion.current;
    const wasAccessResolved = accessResolvedRef.current;
    accessResolvedRef.current = false;
    if (wasAccessResolved) setIsRefreshingSession(true);
    else setIsInitialLoading(true);

    if (!nextSession?.user) {
      const message = pendingSignOutMessage.current;
      clearAccessState(message);
      if (!message) pendingSignOutMessage.current = undefined;
      return;
    }

    updateSessionOnly(nextSession);
    setUserRole(null);
    setDietitianProfile(null);
    setAuthError(null);
    setAccessState({ status: 'resolving_access', userId: nextSession.user.id });

    const resolvedAccess = await resolveAuthAccess(nextSession.user.id);
    if (!mounted.current || requestId !== requestVersion.current) return;

    setUserRole('userRole' in resolvedAccess ? resolvedAccess.userRole : null);
    setDietitianProfile('dietitianProfile' in resolvedAccess ? resolvedAccess.dietitianProfile : null);
    setAccessState(resolvedAccess);
    accessResolvedRef.current = true;
    setIsInitialLoading(false);
    setIsRefreshingSession(false);

    if (resolvedAccess.status === 'blocked_client') {
      await signOut(resolvedAccess.message);
    }
  }, [clearAccessState, signOut, updateSessionOnly]);

  useEffect(() => {
    mounted.current = true;
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (event === 'PASSWORD_RECOVERY') {
        requestVersion.current += 1;
        setSession(nextSession);
        setUser(nextSession?.user ?? null);
        setUserRole(null);
        setDietitianProfile(null);
        setAccessState({ status: 'password_recovery' });
        return;
      }
      const action = getAuthLifecycleAction(
        event,
        nextSession?.user.id ?? null,
        sessionRef.current?.user.id ?? null,
        accessResolvedRef.current,
      );
      if (action === 'ignore_initial_session') return;
      if (action === 'update_session_only' && nextSession) {
        updateSessionOnly(nextSession);
        return;
      }
      void resolveSession(action === 'clear_access' ? null : nextSession);
    });

    supabase.auth.getSession()
      .then(({ data: { session: currentSession }, error }) => {
        if (error) {
          console.error('Initial auth session error:', error);
          if (mounted.current) {
            setAuthError('Oturum kontrol edilirken bir hata oluştu.');
            setAccessState({ status: 'access_error', message: 'Oturum kontrol edilirken bir hata oluştu. Lütfen tekrar deneyin.' });
            accessResolvedRef.current = true;
            setIsInitialLoading(false);
          }
          return;
        }
        void resolveSession(currentSession);
      })
      .catch((error: unknown) => {
        console.error('Initial auth session exception:', error);
        if (mounted.current) {
          setAuthError('Oturum kontrol edilirken bir hata oluştu.');
          setAccessState({ status: 'access_error', message: 'Oturum kontrol edilirken bir hata oluştu. Lütfen tekrar deneyin.' });
          accessResolvedRef.current = true;
          setIsInitialLoading(false);
        }
      });

    return () => {
      mounted.current = false;
      requestVersion.current += 1;
      subscription.unsubscribe();
    };
  }, [resolveSession, updateSessionOnly]);

  const signIn = useCallback(async (email: string, password: string): Promise<AuthSignInResult> => {
    setAuthError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      const safeMessage = getSafeAuthErrorMessage(error);
      setAuthError(safeMessage);
      return { success: false, error: safeMessage };
    }
    return { success: true };
  }, []);

  const refreshAccess = useCallback(async () => {
    setIsRefreshingSession(true);
    const { data: { session: currentSession }, error } = await supabase.auth.getSession();
    if (error) {
      setAccessState({ status: 'access_error', message: 'Erişim bilgileri yenilenemedi. Lütfen tekrar deneyin.' });
      setIsRefreshingSession(false);
      return;
    }
    await resolveSession(currentSession, true);
  }, [resolveSession]);

  const loading = isInitialLoading;

  return (
    <AuthContext.Provider value={{
      session,
      user,
      userRole,
      dietitianProfile,
      accessState,
      loading,
      isInitialLoading,
      isRefreshingSession,
      authError,
      signIn,
      signOut,
      refreshAccess,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
