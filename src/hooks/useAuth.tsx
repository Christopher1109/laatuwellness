import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

type StaffProfile = Tables<"staff_profiles">;

type AuthValue = {
  session: Session | null;
  user: User | null;
  loading: boolean;
  isAdmin: boolean;
  staffProfile: StaffProfile | null;
  isStaff: boolean;
  isCoach: boolean;
  refreshStaffProfile: () => void;
};

const AuthContext = createContext<AuthValue>({
  session: null,
  user: null,
  loading: true,
  isAdmin: false,
  staffProfile: null,
  isStaff: false,
  isCoach: false,
  refreshStaffProfile: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [staffProfile, setStaffProfile] = useState<StaffProfile | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setLoading(false);
    });
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const uid = session?.user.id;
    if (!uid) {
      setIsAdmin(false);
      setStaffProfile(null);
      return;
    }
    let cancelled = false;
    supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", uid)
      .eq("role", "admin")
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setIsAdmin(Boolean(data));
      });
    supabase
      .from("staff_profiles")
      .select("*")
      .eq("user_id", uid)
      .eq("active", true)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setStaffProfile(data ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [session?.user.id, refreshTick]);

  const staffRole = staffProfile?.role;

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        loading,
        // "admin" en user_roles o role=admin en staff_profiles cuentan como admin
        isAdmin: isAdmin || staffRole === "admin",
        staffProfile,
        isStaff: staffProfile !== null,
        isCoach: staffRole === "coach",
        refreshStaffProfile: () => setRefreshTick((t) => t + 1),
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
