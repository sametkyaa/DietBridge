import React, { createContext, useContext, useEffect, useState, PropsWithChildren } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '../../../lib/supabaseClient';
import { DietitianProfile } from '../../../shared/types';
import { getCurrentDietitianProfile } from '../../dietitians/services/dietitianService';

interface AuthContextType {
  session: Session | null;
  user: User | null;
  userRole: string | null;
  dietitianProfile: DietitianProfile | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  userRole: null,
  dietitianProfile: null,
  loading: true,
  signOut: async () => {},
});

export const AuthProvider = ({ children }: PropsWithChildren) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [dietitianProfile, setDietitianProfile] = useState<DietitianProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = async (userId: string) => {
    // Fetch user role
    try {
      const { data: profileData, error } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', userId)
        .maybeSingle();
        
      if (profileData) {
        setUserRole(profileData.role);
      }
    } catch (error) {
      console.error('Error fetching user role:', error);
    }

    // Fetch dietitian profile
    try {
      const profile = await getCurrentDietitianProfile();
      setDietitianProfile(profile);
    } catch (error) {
      console.error('Error fetching dietitian profile:', error);
    }
  };

  useEffect(() => {
    // Check active session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchProfile(session.user.id).finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });

    // Listen for changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        setLoading(true);
        fetchProfile(session.user.id).finally(() => setLoading(false));
      } else {
        setUserRole(null);
        setDietitianProfile(null);
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ session, user, userRole, dietitianProfile, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);