type TeamAccess = {
  isAdmin: boolean;
  isStaff: boolean;
  isCoach: boolean;
};

/** Navigation only; the shared panel and database retain their role checks. */
export function appTeamDestination(access: TeamAccess): "/admin" | null {
  return access.isAdmin || access.isStaff || access.isCoach ? "/admin" : null;
}
