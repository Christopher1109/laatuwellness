import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

type StaffProfile = Tables<"staff_profiles">;

type AuthValue = {
  session: Session | null;
  user: User | null;
  loading: boolean;
  rolesLoading: boolean;
  isAdmin: boolean;
  staffProfile: StaffProfile | null;
  isStaff: boolean;
  isCoach: boolean;
  /** DorisFisio: atiende el consultorio de recuperación (no es coach). */
  isRecovery: boolean;
  refreshStaffProfile: () => void;
};

const AuthContext = createContext<AuthValue>({
  session: null,
  user: null,
  loading: true,
  rolesLoading: true,
  isAdmin: false,
  staffProfile: null,
  isStaff: false,
  isCoach: false,
  isRecovery: false,
  refreshStaffProfile: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [staffProfile, setStaffProfile] = useState<StaffProfile | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [resolvedRoles, setResolvedRoles] = useState<{ userId: string; tick: number } | null>(null);

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
      setResolvedRoles(null);
      return;
    }
    let cancelled = false;
    const adminRequest = supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", uid)
      .eq("role", "admin")
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setIsAdmin(Boolean(data));
      });
    const staffRequest = supabase
      .from("staff_profiles")
      .select("*")
      .eq("user_id", uid)
      .eq("active", true)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setStaffProfile(data ?? null);
      });
    void Promise.all([adminRequest, staffRequest]).then(() => {
      if (!cancelled) setResolvedRoles({ userId: uid, tick: refreshTick });
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
        rolesLoading:
          loading ||
          Boolean(
            session?.user.id &&
            (resolvedRoles?.userId !== session.user.id || resolvedRoles?.tick !== refreshTick),
          ),
        // "admin" en user_roles o role=admin en staff_profiles cuentan como admin
        isAdmin: isAdmin || staffRole === "admin",
        staffProfile,
        isStaff: staffProfile !== null,
        isCoach: staffRole === "coach",
        isRecovery: staffRole === "recovery",
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
