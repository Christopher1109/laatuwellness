import { normalizeHex } from "@/lib/coach-colors";

export type TeamRole = "admin" | "staff" | "coach" | "recovery";

/** Alta o edición de una persona del equipo con su acceso al sistema. */
export type TeamMemberInput = {
  id: string | null;
  fullName: string;
  email: string;
  phone: string | null;
  photoUrl: string | null;
  role: TeamRole;
  hourlyRateCents: number;
  active: boolean;
  color: string | null;
  /** Contraseña nueva (opcional). Vacía = no se cambia. */
  password: string | null;
};

const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROLES: readonly TeamRole[] = ["admin", "staff", "coach", "recovery"];

export function validateTeamMember(
  raw: Partial<TeamMemberInput> | null | undefined,
): TeamMemberInput {
  const input = raw ?? {};
  const id = input.id ? String(input.id) : null;
  if (id && !UUID.test(id)) throw new Error("Perfil inválido.");

  const fullName = String(input.fullName ?? "")
    .trim()
    .slice(0, 120);
  if (!fullName) throw new Error("El nombre es obligatorio.");

  const email = String(input.email ?? "")
    .trim()
    .toLowerCase()
    .slice(0, 200);
  if (email && !EMAIL.test(email)) throw new Error("El correo no es válido.");

  const role = input.role as TeamRole;
  if (!ROLES.includes(role)) throw new Error("Rol inválido.");

  const password = input.password ? String(input.password) : "";
  if (password && (password.length < 8 || password.length > 72)) {
    throw new Error("La contraseña debe tener entre 8 y 72 caracteres.");
  }
  if (password && !email) {
    throw new Error("Para darle acceso con contraseña necesita un correo.");
  }

  const rate = Math.round(Number(input.hourlyRateCents ?? 0));
  const phone = String(input.phone ?? "")
    .replace(/[^\d+\s()-]/g, "")
    .trim()
    .slice(0, 30);
  const photoUrl = String(input.photoUrl ?? "")
    .trim()
    .slice(0, 500);

  return {
    id,
    fullName,
    email,
    phone: phone || null,
    photoUrl: photoUrl || null,
    role,
    hourlyRateCents: Number.isFinite(rate) && rate > 0 ? rate : 0,
    active: input.active !== false,
    color: normalizeHex(input.color ?? null),
    password: password || null,
  };
}
