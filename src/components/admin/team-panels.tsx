import { useMemo, useState } from "react";
import { classTitle } from "@/lib/class-focus";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Cake,
  ChevronLeft,
  ChevronRight,
  Clock,
  HeartPulse,
  KeyRound,
  MapPin,
  Sparkles,
  Users,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import { TEAM_ROLE_LABELS } from "@/lib/credit-kinds";
import { coachSwatch, normalizeHex } from "@/lib/coach-colors";
import type { TeamRole } from "@/lib/team-member";
import { saveTeamMember } from "@/utils/team-admin.functions";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Popout, input } from "@/components/admin/ops-panels";
import { Schedule } from "@/components/schedule";

// ============================================================================
// EQUIPO — Staff y Coaches se ven por bloques (tarjetas). "Editar" abre un
// formulario con los datos y el acceso: correo + contraseña se guardan
// directo, sin mandar correos.
// ============================================================================

type StaffRow = Tables<"staff_profiles">;
type ClassRow = Tables<"classes">;

const money = (cents: number) =>
  new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format((cents ?? 0) / 100);

const ROLE_LABELS: Record<TeamRole, string> = {
  admin: "Administración",
  staff: "Staff / recepción",
  coach: "Coach",
  recovery: "Recovery (DorisFisio)",
};

const MODULE_LABELS: Record<string, string> = {
  reformer: "Reformer",
  "4mat": "4mat",
  contraste: "Contrast Therapy",
  nutricion: "Nutrición",
  psicologia: "Psicología",
  rehabilitacion: "DorisFisio",
};

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

function TeamCard({
  person,
  onEdit,
  onOpen,
}: {
  person: StaffRow;
  onEdit: () => void;
  onOpen?: () => void;
}) {
  const color = normalizeHex(person.color);
  const header = (
    <>
      <Avatar className="h-10 w-10">
        {person.photo_url ? <AvatarImage src={person.photo_url} alt="" /> : null}
        <AvatarFallback className="text-xs" style={coachSwatch(color)}>
          {initials(person.full_name)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{person.full_name}</p>
        <p className="truncate text-xs text-muted-foreground">
          {ROLE_LABELS[person.role as TeamRole] ?? person.role}
          {person.hourly_rate_cents ? ` · ${money(person.hourly_rate_cents)}/h` : ""}
        </p>
      </div>
    </>
  );
  return (
    <div
      className={cn("flex flex-col gap-3 border border-border p-4", !person.active && "opacity-50")}
      style={color ? { borderLeft: `4px solid ${color}` } : undefined}
    >
      {onOpen ? (
        <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 text-left">
          {header}
        </button>
      ) : (
        <div className="flex items-center gap-3">{header}</div>
      )}
      <div className="space-y-1 text-xs text-muted-foreground">
        <p className="truncate">{person.email || "Sin correo"}</p>
        <p className="flex items-center gap-1.5">
          <KeyRound className="h-3 w-3" />
          {person.user_id ? (
            <span className="text-emerald-700">Con acceso al sistema</span>
          ) : (
            <span className="text-amber-700">Sin acceso: asígnale contraseña</span>
          )}
          {person.active ? "" : " · inactivo"}
        </p>
      </div>
      <button
        type="button"
        onClick={onEdit}
        className="w-full border border-input px-3 py-2 text-[0.65rem] uppercase tracking-[0.12em] hover:bg-foreground hover:text-background"
      >
        Editar
      </button>
    </div>
  );
}

function useTeam(kind: "staff" | "coach") {
  return useQuery({
    queryKey: ["admin-team", kind],
    queryFn: async () => {
      let q = supabase.from("staff_profiles").select("*").order("full_name");
      q = kind === "coach" ? q.eq("role", "coach") : q.neq("role", "coach");
      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
  });
}

export function StaffDirectoryPanel() {
  const { data } = useTeam("staff");
  const [editing, setEditing] = useState<StaffRow | "new" | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const list = (data ?? []).filter((s) => showInactive || s.active);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-xs text-muted-foreground">
          Staff, recovery y administración. Para darle acceso a alguien solo pon su correo y una
          contraseña en "Editar": entra de inmediato con esos datos, sin correos de confirmación.
        </p>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
            />
            Ver inactivos
          </label>
          <button
            type="button"
            onClick={() => setEditing("new")}
            className="bg-foreground px-4 py-2.5 text-[0.7rem] uppercase tracking-[0.16em] text-background"
          >
            + Nuevo miembro
          </button>
        </div>
      </div>
      {list.length === 0 ? (
        <p className="text-muted-foreground">Sin personas dadas de alta todavía.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {list.map((s) => (
            <TeamCard key={s.id} person={s} onEdit={() => setEditing(s)} />
          ))}
        </div>
      )}
      {editing ? (
        <TeamMemberEditPopout
          person={editing === "new" ? null : editing}
          defaultRole="staff"
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}

export function CoachesPanel() {
  const { data } = useTeam("coach");
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState<StaffRow | "new" | null>(null);

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <button
          type="button"
          onClick={() => setEditing("new")}
          className="bg-foreground px-4 py-2.5 text-[0.7rem] uppercase tracking-[0.16em] text-background"
        >
          + Nuevo coach
        </button>
      </div>
      {(data ?? []).length === 0 ? (
        <p className="text-muted-foreground">Sin coaches dados de alta todavía.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {(data ?? []).map((c) => (
            <TeamCard
              key={c.id}
              person={c}
              onOpen={() => setOpenId(c.id)}
              onEdit={() => setEditing(c)}
            />
          ))}
        </div>
      )}

      {openId ? (
        <Popout onClose={() => setOpenId(null)} wide>
          <CoachClassesView coachId={openId} />
          <div className="mt-8">
            <CoachPaySection coachId={openId} title="Nómina estimada" />
          </div>
          <div className="mt-8 border-t border-border pt-6">
            <CoachRateTiersEditor coachId={openId} />
          </div>
        </Popout>
      ) : null}
      {editing ? (
        <TeamMemberEditPopout
          person={editing === "new" ? null : editing}
          defaultRole="coach"
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}

function TeamMemberEditPopout({
  person,
  defaultRole,
  onClose,
}: {
  person: StaffRow | null;
  defaultRole: TeamRole;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const save = useServerFn(saveTeamMember);
  const [role, setRole] = useState<TeamRole>((person?.role as TeamRole) ?? defaultRole);
  const [color, setColor] = useState(normalizeHex(person?.color) ?? "#D7E1EF");
  const [useColor, setUseColor] = useState(Boolean(normalizeHex(person?.color)));
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["admin-team"] });
    void qc.invalidateQueries({ queryKey: ["schedule-planner-coaches"] });
    void qc.invalidateQueries({ queryKey: ["admin-schedule-staff-coaches"] });
  };

  const mutation = useMutation({
    mutationFn: async (payload: Parameters<typeof save>[0]["data"]) => save({ data: payload }),
    onSuccess: (res) => {
      toast.success(
        res.hasAccess
          ? "Guardado. Ya puede entrar con su correo y contraseña."
          : "Guardado. Para que pueda entrar, asígnale una contraseña.",
      );
      refresh();
      onClose();
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo guardar."),
  });

  const deactivate = useMutation({
    mutationFn: async () => {
      if (!person) return;
      const { error } = await supabase
        .from("staff_profiles")
        .update({ active: !person.active })
        .eq("id", person.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(
        person?.active ? "Se desactivó: ya no aparece ni entra al panel." : "Reactivado.",
      );
      refresh();
      onClose();
    },
    onError: () => toast.error("No se pudo cambiar el estado."),
  });

  return (
    <Popout onClose={onClose}>
      <h3 className="statement text-2xl">
        {person
          ? `Editar a ${person.full_name}`
          : role === "coach"
            ? "Nuevo coach"
            : role === "recovery"
              ? "Nueva persona de recovery"
              : "Nuevo miembro"}
      </h3>
      <form
        className="mt-6 grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (password && password !== confirmation) {
            toast.error("Las contraseñas no coinciden.");
            return;
          }
          const f = new FormData(e.currentTarget);
          mutation.mutate({
            id: person?.id ?? null,
            fullName: String(f.get("full_name") || ""),
            email: String(f.get("email") || ""),
            phone: String(f.get("phone") || ""),
            photoUrl: String(f.get("photo_url") || ""),
            role,
            hourlyRateCents: Math.round(Number(f.get("rate") || 0) * 100),
            active: f.get("active") === "on",
            color: (role === "coach" || role === "recovery") && useColor ? color : null,
            password: password || null,
          });
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-xs sm:col-span-2">
            <span className="eyebrow">Nombre</span>
            <input
              name="full_name"
              required
              defaultValue={person?.full_name ?? ""}
              className={input}
            />
          </label>
          <label className="text-xs">
            <span className="eyebrow">Rol</span>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as TeamRole)}
              className={input}
            >
              <option value="staff">Staff / recepción</option>
              <option value="coach">Coach</option>
              <option value="recovery">Recovery / consultorio (no es coach)</option>
              <option value="admin">Administración</option>
            </select>
          </label>
          <label className="text-xs">
            <span className="eyebrow">Tarifa por hora (MXN)</span>
            <input
              name="rate"
              type="number"
              min={0}
              step="0.01"
              defaultValue={person ? person.hourly_rate_cents / 100 : 0}
              className={input}
            />
          </label>
          <label className="text-xs">
            <span className="eyebrow">Teléfono</span>
            <input name="phone" defaultValue={person?.phone ?? ""} className={input} />
          </label>
          <label className="text-xs">
            <span className="eyebrow">Foto (URL)</span>
            <input name="photo_url" defaultValue={person?.photo_url ?? ""} className={input} />
          </label>
          {role === "recovery" ? (
            <p className="text-xs text-muted-foreground sm:col-span-2">
              Recovery atiende el consultorio de DorisFisio: programa y ve su consultorio, ve a los
              clientes, les aparta sesiones cobrando su crédito, edita sus paquetes y revisa sus
              consultas. No aparece como coach.
            </p>
          ) : null}
          {role === "coach" || role === "recovery" ? (
            <div className="text-xs sm:col-span-2">
              <span className="eyebrow">Color en los horarios</span>
              <div className="mt-1 flex items-center gap-3">
                <input
                  type="color"
                  value={color}
                  onChange={(e) => {
                    setColor(e.target.value);
                    setUseColor(true);
                  }}
                  className="h-10 w-14 cursor-pointer border border-input bg-transparent"
                  aria-label="Color del coach"
                />
                <span className="px-3 py-1.5" style={useColor ? coachSwatch(color) : undefined}>
                  {useColor ? "Así se ve en la programación" : "Color automático"}
                </span>
                {useColor ? (
                  <button
                    type="button"
                    onClick={() => setUseColor(false)}
                    className="text-[0.65rem] uppercase tracking-[0.12em] text-muted-foreground underline"
                  >
                    Quitar
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>

        <div className="grid gap-4 border border-border p-4 sm:grid-cols-2">
          <p className="eyebrow sm:col-span-2">Acceso al sistema</p>
          <label className="text-xs sm:col-span-2">
            <span className="eyebrow">Correo para entrar</span>
            <input
              name="email"
              type="email"
              autoComplete="off"
              defaultValue={person?.email ?? ""}
              className={input}
            />
          </label>
          <label className="text-xs">
            <span className="eyebrow">{person?.user_id ? "Nueva contraseña" : "Contraseña"}</span>
            <input
              type="password"
              autoComplete="new-password"
              minLength={8}
              maxLength={72}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={input}
            />
          </label>
          <label className="text-xs">
            <span className="eyebrow">Confirmar contraseña</span>
            <input
              type="password"
              autoComplete="new-password"
              minLength={8}
              maxLength={72}
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              className={input}
            />
          </label>
          <p className="text-xs text-muted-foreground sm:col-span-2">
            {person?.user_id
              ? "Deja la contraseña vacía para no cambiarla. Si cambias el correo, desde ahora entra con el nuevo."
              : "Con correo y contraseña la cuenta queda lista para entrar de inmediato (mínimo 8 caracteres). No se envía ningún correo."}
          </p>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input name="active" type="checkbox" defaultChecked={person?.active ?? true} />
          Activo
        </label>

        <div className="flex flex-wrap justify-between gap-2 pt-2">
          {person ? (
            <button
              type="button"
              disabled={deactivate.isPending}
              onClick={() => {
                if (
                  !person.active ||
                  confirm(`¿Desactivar a ${person.full_name}? Ya no podrá entrar al panel.`)
                )
                  deactivate.mutate();
              }}
              className="border border-input px-4 py-2.5 text-[0.7rem] uppercase tracking-[0.16em] text-destructive disabled:opacity-50"
            >
              {person.active ? "Desactivar" : "Reactivar"}
            </button>
          ) : (
            <span />
          )}
          <button
            disabled={mutation.isPending}
            className="bg-foreground px-4 py-2.5 text-[0.7rem] uppercase tracking-[0.16em] text-background disabled:opacity-50"
          >
            {mutation.isPending ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </form>
    </Popout>
  );
}

// ============================================================================
// Vista de clases de un coach por bloques: hoy, próximas y el mes (con
// pasadas), con reservaciones, cancelaciones y lista de espera. La usan el
// perfil del coach y el detalle del coach en administración.
// ============================================================================

type BookingStats = { reservada: number; cancelada: number; lista_espera: number };
const EMPTY_STATS: BookingStats = { reservada: 0, cancelada: 0, lista_espera: 0 };

function monthBounds(cursor: Date) {
  const start = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const end = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  return { start, end };
}

function CoachClassesView({ coachId }: { coachId: string }) {
  const [tab, setTab] = useState<"hoy" | "proximas" | "mes">("hoy");
  const [monthCursor, setMonthCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [rosterFor, setRosterFor] = useState<ClassRow | null>(null);
  const month = useMemo(() => monthBounds(monthCursor), [monthCursor]);

  const { data: coach } = useQuery({
    queryKey: ["coach-detail-profile", coachId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("staff_profiles")
        .select("*")
        .eq("id", coachId)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const { data: classTypes } = useQuery({
    queryKey: ["public-class-types"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("class_types")
        .select("id, name")
        .eq("active", true);
      if (error) throw error;
      return new Map((data ?? []).map((t) => [t.id, t.name]));
    },
  });

  const { data: monthClasses } = useQuery({
    queryKey: ["coach-classes", coachId, "month", month.start.toISOString()],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("classes")
        .select("*")
        .eq("coach_id", coachId)
        .eq("active", true)
        .gte("starts_at", month.start.toISOString())
        .lt("starts_at", month.end.toISOString())
        .order("starts_at");
      if (error) throw error;
      return data;
    },
  });

  const { data: upcoming } = useQuery({
    queryKey: ["coach-classes", coachId, "upcoming"],
    queryFn: async () => {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(end.getDate() + 31);
      const { data, error } = await supabase
        .from("classes")
        .select("*")
        .eq("coach_id", coachId)
        .eq("active", true)
        .gte("starts_at", start.toISOString())
        .lt("starts_at", end.toISOString())
        .order("starts_at");
      if (error) throw error;
      return data;
    },
  });

  const allIds = useMemo(
    () =>
      Array.from(new Set([...(monthClasses ?? []), ...(upcoming ?? [])].map((c) => c.id))).sort(),
    [monthClasses, upcoming],
  );

  const { data: stats } = useQuery({
    queryKey: ["coach-class-stats", allIds.join(",")],
    enabled: allIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bookings")
        .select("class_id, status")
        .in("class_id", allIds);
      if (error) throw error;
      const map = new Map<string, BookingStats>();
      for (const b of data ?? []) {
        const acc = { ...(map.get(b.class_id) ?? EMPTY_STATS) };
        if (b.status === "reservada") acc.reservada += 1;
        if (b.status === "cancelada") acc.cancelada += 1;
        if (b.status === "lista_espera") acc.lista_espera += 1;
        map.set(b.class_id, acc);
      }
      return map;
    },
  });

  const now = Date.now();
  const todayKey = new Date().toDateString();
  const todays = (upcoming ?? []).filter((c) => new Date(c.starts_at).toDateString() === todayKey);
  const future = (upcoming ?? []).filter((c) => new Date(c.starts_at).getTime() > now);

  const monthTotals = (monthClasses ?? []).reduce(
    (acc, c) => {
      const s = stats?.get(c.id) ?? EMPTY_STATS;
      const past = new Date(c.starts_at).getTime() + c.duration_min * 60000 <= now;
      acc.clases += 1;
      if (past) acc.impartidas += 1;
      acc.reservas += s.reservada;
      acc.cancelaciones += s.cancelada;
      acc.espera += s.lista_espera;
      acc.cupo += c.capacity;
      return acc;
    },
    { clases: 0, impartidas: 0, reservas: 0, cancelaciones: 0, espera: 0, cupo: 0 },
  );
  const occupancy = monthTotals.cupo
    ? Math.round((monthTotals.reservas / monthTotals.cupo) * 100)
    : 0;

  const list = tab === "hoy" ? todays : tab === "proximas" ? future : (monthClasses ?? []);
  const monthLabel = new Intl.DateTimeFormat("es-MX", { month: "long", year: "numeric" }).format(
    monthCursor,
  );
  const color = normalizeHex(coach?.color);

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Avatar className="h-11 w-11">
            {coach?.photo_url ? <AvatarImage src={coach.photo_url} alt="" /> : null}
            <AvatarFallback style={coachSwatch(color)}>
              {initials(coach?.full_name ?? "")}
            </AvatarFallback>
          </Avatar>
          <div>
            <p className="text-lg font-medium">{coach?.full_name}</p>
            <p className="text-xs text-muted-foreground">
              {todays.length} {todays.length === 1 ? "clase" : "clases"} hoy · {future.length}{" "}
              próximas
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setMonthCursor((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))}
            className="p-1.5 text-muted-foreground hover:text-foreground"
            aria-label="Mes anterior"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-[8rem] text-center text-xs capitalize">{monthLabel}</span>
          <button
            type="button"
            onClick={() => setMonthCursor((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))}
            className="p-1.5 text-muted-foreground hover:text-foreground"
            aria-label="Mes siguiente"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {[
          ["Clases del mes", monthTotals.clases],
          ["Impartidas", monthTotals.impartidas],
          ["Reservaciones", monthTotals.reservas],
          ["Cancelaciones", monthTotals.cancelaciones],
          ["Lista de espera", monthTotals.espera],
          ["Ocupación", `${occupancy}%`],
        ].map(([label, value]) => (
          <div key={String(label)} className="border border-border p-3">
            <p className="text-[0.65rem] uppercase tracking-[0.1em] text-muted-foreground">
              {label}
            </p>
            <p className="mt-1 text-xl">{value}</p>
          </div>
        ))}
      </div>

      <CoachInsightsSection coachId={coachId} month={month} />

      <div className="mb-4 flex flex-wrap gap-1.5">
        {(
          [
            ["hoy", `Hoy (${todays.length})`],
            ["proximas", `Próximas (${future.length})`],
            ["mes", `Todo el mes (${(monthClasses ?? []).length})`],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              "border px-3 py-1.5 text-[0.65rem] uppercase tracking-[0.12em]",
              tab === key ? "border-foreground bg-foreground text-background" : "border-input",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {list.length === 0 ? (
        <p className="py-6 text-sm text-muted-foreground">
          {tab === "hoy" ? "Sin clases hoy." : "Sin clases en este rango."}
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((c) => (
            <ClassBlock
              key={c.id}
              cls={c}
              typeName={
                c.class_type_id
                  ? classTitle(classTypes?.get(c.class_type_id), c.starts_at)
                  : undefined
              }
              stats={stats?.get(c.id) ?? EMPTY_STATS}
              showDate={tab !== "hoy"}
              onOpen={() => setRosterFor(c)}
            />
          ))}
        </div>
      )}

      {rosterFor ? (
        <ClassRosterPopout
          cls={rosterFor}
          typeName={
            rosterFor.class_type_id
              ? classTitle(classTypes?.get(rosterFor.class_type_id), rosterFor.starts_at)
              : undefined
          }
          onClose={() => setRosterFor(null)}
        />
      ) : null}
    </div>
  );
}

function ClassBlock({
  cls,
  typeName,
  stats,
  showDate,
  onOpen,
}: {
  cls: ClassRow;
  typeName: string | undefined;
  stats: BookingStats;
  showDate: boolean;
  onOpen: () => void;
}) {
  const start = new Date(cls.starts_at);
  const end = new Date(start.getTime() + cls.duration_min * 60000);
  const now = Date.now();
  const finished = end.getTime() <= now;
  const inProgress = !finished && start.getTime() <= now;
  const full = stats.reservada >= cls.capacity;
  const pct = Math.min(100, Math.round((stats.reservada / Math.max(cls.capacity, 1)) * 100));
  const time = new Intl.DateTimeFormat("es-MX", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "flex flex-col gap-2 rounded-lg border border-border bg-background p-3.5 text-left shadow-sm transition-colors hover:border-foreground/30",
        finished && "bg-muted/60 opacity-70 shadow-none",
        inProgress && "border-emerald-500/60",
      )}
    >
      <p className="text-[0.68rem] uppercase tracking-[0.08em] text-muted-foreground">
        {showDate
          ? `${new Intl.DateTimeFormat("es-MX", { weekday: "short", day: "numeric", month: "short" }).format(start)} · `
          : ""}
        {time.format(start)} – {time.format(end)} ·{" "}
        {finished ? "Concluida" : inProgress ? "En curso" : "Próxima"}
      </p>
      <p className="truncate text-sm font-semibold">
        {typeName ?? MODULE_LABELS[cls.module_key ?? ""] ?? cls.module_key}
      </p>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <MapPin className="h-3 w-3" /> {cls.room}
        </span>
        <span className="inline-flex items-center gap-1">
          <Clock className="h-3 w-3" /> {cls.duration_min} min
        </span>
      </p>
      <div className="flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
          <div
            className={cn("h-full rounded-full", full ? "bg-destructive" : "bg-emerald-500")}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="shrink-0 text-[0.68rem] tabular-nums text-muted-foreground">
          {stats.reservada}/{cls.capacity}
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5 text-[0.62rem]">
        {stats.lista_espera > 0 ? (
          <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-amber-700">
            {stats.lista_espera} en espera
          </span>
        ) : null}
        {stats.cancelada > 0 ? (
          <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
            {stats.cancelada} canceló
          </span>
        ) : null}
      </div>
    </button>
  );
}

function ClassRosterPopout({
  cls,
  typeName,
  onClose,
}: {
  cls: ClassRow;
  typeName: string | undefined;
  onClose: () => void;
}) {
  const {
    data: roster,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["coach-class-roster", cls.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("coach_class_roster", { _class_id: cls.id });
      if (error) throw error;
      return data ?? [];
    },
  });
  const groups = [
    ["reservada", "Reservaciones"],
    ["lista_espera", "Lista de espera"],
    ["cancelada", "Canceladas"],
  ] as const;
  return (
    <Popout onClose={onClose}>
      <p className="eyebrow">
        {new Intl.DateTimeFormat("es-MX", {
          weekday: "long",
          day: "numeric",
          month: "long",
          hour: "2-digit",
          minute: "2-digit",
        }).format(new Date(cls.starts_at))}
      </p>
      <h3 className="statement mt-1 text-2xl">
        {typeName ?? MODULE_LABELS[cls.module_key ?? ""] ?? cls.module_key}
      </h3>
      <p className="mt-1 text-xs text-muted-foreground">
        {cls.room} · cupo {cls.capacity}
      </p>
      {isLoading ? <p className="mt-4 text-sm text-muted-foreground">Cargando…</p> : null}
      {error ? (
        <p className="mt-4 text-sm text-destructive">No se pudo cargar la lista de esta clase.</p>
      ) : null}
      <div className="mt-5 space-y-5">
        {groups.map(([status, label]) => {
          const people = (roster ?? []).filter((r) => r.status === status);
          return (
            <div key={status}>
              <p className="eyebrow mb-2 flex items-center gap-1.5">
                <Users className="h-3 w-3" /> {label} ({people.length})
              </p>
              {people.length === 0 ? (
                <p className="text-xs text-muted-foreground">Nadie.</p>
              ) : (
                <ul className="divide-y divide-border border-y border-border text-sm">
                  {people.map((p) => (
                    <li key={p.booking_id} className="py-2.5">
                      <div className="flex items-center justify-between gap-3">
                        <span className="flex min-w-0 items-center gap-2">
                          {p.seat_number ? (
                            <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-foreground text-[0.6rem] text-background">
                              {p.seat_number}
                            </span>
                          ) : null}
                          <span className="truncate">{p.full_name || "Sin nombre"}</span>
                          {p.birthday_soon ? (
                            <Cake
                              className="h-3.5 w-3.5 shrink-0 text-pink-600"
                              aria-label="Cumpleaños esta semana"
                            />
                          ) : null}
                        </span>
                        {status === "reservada" ? <ArrivalBadge status={p.checkin_status} /> : null}
                      </div>
                      {status !== "cancelada" ? (
                        <div className="mt-1 flex flex-wrap gap-1.5 pl-7 text-[0.62rem]">
                          {p.first_visit ? (
                            <span className="inline-flex items-center gap-1 bg-sky-500/10 px-1.5 py-0.5 text-sky-800">
                              <Sparkles className="h-3 w-3" /> Primera vez
                            </span>
                          ) : (
                            <span className="text-muted-foreground">
                              {p.visits} {p.visits === 1 ? "clase" : "clases"} antes
                            </span>
                          )}
                          {p.is_guest ? (
                            <span className="bg-muted px-1.5 py-0.5 text-muted-foreground">
                              Invitada
                            </span>
                          ) : null}
                          {p.birthday_soon ? (
                            <span className="bg-pink-500/10 px-1.5 py-0.5 text-pink-700">
                              Cumpleaños esta semana
                            </span>
                          ) : null}
                        </div>
                      ) : null}
                      {p.health_notes && status !== "cancelada" ? (
                        <p className="mt-1.5 ml-7 flex gap-1.5 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-900">
                          <HeartPulse className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          <span className="whitespace-pre-line">{p.health_notes}</span>
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </Popout>
  );
}

function ArrivalBadge({ status }: { status: string | null }) {
  if (!status) {
    return <span className="shrink-0 text-[0.6rem] text-muted-foreground">Por llegar</span>;
  }
  const map: Record<string, [string, string]> = {
    a_tiempo: ["Llegó", "bg-emerald-500/10 text-emerald-700"],
    tarde: ["Llegó tarde", "bg-amber-500/10 text-amber-700"],
    no_show: ["No llegó", "bg-destructive/10 text-destructive"],
  };
  const [label, cls] = map[status] ?? [status, "bg-muted text-muted-foreground"];
  return <span className={cn("shrink-0 px-1.5 py-0.5 text-[0.6rem]", cls)}>{label}</span>;
}

type CoachInsights = {
  classes_given: number;
  attended: number;
  late: number;
  no_shows: number;
  avg_attendance: number | null;
  unique_students: number;
  top_students: { name: string; visits: number }[];
  birthdays: { name: string; date: string }[];
};

function CoachInsightsSection({
  coachId,
  month,
}: {
  coachId: string;
  month: { start: Date; end: Date };
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["coach-insights", coachId, month.start.toISOString()],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("coach_insights", {
        _coach_id: coachId,
        _from: month.start.toISOString(),
        _to: month.end.toISOString(),
      });
      if (error) throw error;
      return data as unknown as CoachInsights;
    },
  });
  if (isLoading || !data) return null;
  const bdayFmt = new Intl.DateTimeFormat("es-MX", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
  return (
    <div className="mb-6 grid gap-3 lg:grid-cols-3">
      <div className="border border-border p-4">
        <p className="eyebrow">Asistencia del mes</p>
        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          <Stat label="Asistencias" value={data.attended} />
          <Stat label="Promedio por clase" value={data.avg_attendance ?? 0} />
          <Stat label="Alumnas distintas" value={data.unique_students} />
          <Stat label="Llegaron tarde" value={data.late} />
          <Stat label="No llegaron" value={data.no_shows} />
          <Stat label="Clases dadas" value={data.classes_given} />
        </div>
      </div>
      <div className="border border-border p-4">
        <p className="eyebrow">Alumnas frecuentes</p>
        {data.top_students.length === 0 ? (
          <p className="mt-3 text-xs text-muted-foreground">Aún no hay asistencias este mes.</p>
        ) : (
          <ol className="mt-3 space-y-1.5 text-sm">
            {data.top_students.map((t, i) => (
              <li key={t.name + i} className="flex items-center justify-between gap-3">
                <span className="truncate">
                  <span className="mr-2 text-[0.65rem] text-muted-foreground">{i + 1}</span>
                  {t.name}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {t.visits} {t.visits === 1 ? "clase" : "clases"}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
      <div className="border border-border p-4">
        <p className="eyebrow flex items-center gap-1.5">
          <Cake className="h-3.5 w-3.5" /> Cumpleaños esta semana
        </p>
        {data.birthdays.length === 0 ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Ninguna de tus alumnas cumple años en los próximos 7 días.
          </p>
        ) : (
          <ul className="mt-3 space-y-1.5 text-sm">
            {data.birthdays.map((b, i) => (
              <li key={b.name + i} className="flex items-center justify-between gap-3">
                <span className="truncate">{b.name}</span>
                <span className="shrink-0 text-xs capitalize text-muted-foreground">
                  {bdayFmt.format(new Date(`${b.date}T00:00:00Z`))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <p className="text-xl leading-none">{value}</p>
      <p className="mt-1 text-[0.6rem] uppercase tracking-[0.1em] text-muted-foreground">{label}</p>
    </div>
  );
}

function CoachRateTiersEditor({ coachId }: { coachId: string }) {
  const qc = useQueryClient();
  const [minAttendance, setMinAttendance] = useState("");
  const [rate, setRate] = useState("");

  const { data: tiers } = useQuery({
    queryKey: ["coach-rate-tiers", coachId],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- coach_rate_tiers no está en los tipos generados todavía
      const { data, error } = await (supabase.from as any)("coach_rate_tiers")
        .select("*")
        .eq("coach_id", coachId)
        .order("min_attendance");
      if (error) throw error;
      return data as { id: string; min_attendance: number; rate_cents: number }[];
    },
  });

  const add = useMutation({
    mutationFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- coach_rate_tiers no está en los tipos generados todavía
      const { error } = await (supabase.from as any)("coach_rate_tiers").insert({
        coach_id: coachId,
        min_attendance: Number(minAttendance),
        rate_cents: Math.round(Number(rate) * 100),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Rango agregado.");
      setMinAttendance("");
      setRate("");
      void qc.invalidateQueries({ queryKey: ["coach-rate-tiers", coachId] });
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo agregar."),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- coach_rate_tiers no está en los tipos generados todavía
      const { error } = await (supabase.from as any)("coach_rate_tiers").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["coach-rate-tiers", coachId] }),
  });

  return (
    <div>
      <p className="eyebrow">Pago por ocupación del salón</p>
      <p className="mt-2 text-xs text-muted-foreground">
        Precio fijo por clase según cuántas personas asistieron. Se aplica el rango más alto que no
        se pase de la asistencia real. Si no configuras nada aquí, este coach sigue cobrando por
        hora como de costumbre.
      </p>

      <ul className="mt-4 divide-y divide-border border-y border-border text-sm">
        {(tiers ?? []).map((t) => (
          <li key={t.id} className="flex items-center justify-between gap-4 py-2.5">
            <span>
              Desde {t.min_attendance} {t.min_attendance === 1 ? "persona" : "personas"}
            </span>
            <span className="flex items-center gap-3">
              <span className="font-mono">{money(t.rate_cents)} / clase</span>
              <button
                type="button"
                onClick={() => remove.mutate(t.id)}
                className="text-xs uppercase tracking-wide text-muted-foreground hover:text-destructive"
              >
                Quitar
              </button>
            </span>
          </li>
        ))}
        {(tiers ?? []).length === 0 ? (
          <li className="py-3 text-muted-foreground">Sin rangos configurados.</li>
        ) : null}
      </ul>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="text-xs">
          <span className="eyebrow">Desde (personas)</span>
          <input
            type="number"
            min="0"
            value={minAttendance}
            onChange={(e) => setMinAttendance(e.target.value)}
            className={`${input} w-32`}
          />
        </label>
        <label className="text-xs">
          <span className="eyebrow">Precio por clase (MXN)</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            className={`${input} w-32`}
          />
        </label>
        <button
          type="button"
          onClick={() => add.mutate()}
          disabled={!minAttendance || !rate || add.isPending}
          className="border border-input px-4 py-2.5 text-[0.68rem] uppercase tracking-[0.14em] hover:bg-muted disabled:opacity-50"
        >
          + Agregar rango
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// PERFIL DEL COACH (lo que ve el coach al entrar): sus clases de hoy, las
// próximas y el mes con reservaciones, cancelaciones y lista de espera.
// ============================================================================
type CoachPaySummary = {
  rate_cents: number;
  by_tiers: boolean;
  classes_given: number;
  minutes_given: number;
  earned_cents: number;
  classes_scheduled: number;
  projected_cents: number;
  adjustments_cents: number;
  classes: {
    class_id: string;
    starts_at: string;
    class_name: string | null;
    module_key: string | null;
    attendance: number;
    given: boolean;
    pay_cents: number;
  }[];
};

/**
 * Nómina estimada del mes: clases impartidas × tarifa (o rangos por
 * asistencia), ajustes capturados y lo que falta según el horario. La ve la
 * propia coach y administración.
 */
export function CoachPaySection({
  coachId,
  title = "Mi nómina",
}: {
  coachId: string;
  title?: string;
}) {
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [showDetail, setShowDetail] = useState(false);
  const month = useMemo(() => monthBounds(cursor), [cursor]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["coach-pay-summary", coachId, month.start.toISOString()],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("coach_pay_summary", {
        _coach_id: coachId,
        _from: month.start.toISOString(),
        _to: month.end.toISOString(),
      });
      if (error) throw error;
      return data as unknown as CoachPaySummary;
    },
  });

  const monthLabel = new Intl.DateTimeFormat("es-MX", { month: "long", year: "numeric" }).format(
    cursor,
  );
  const total = (data?.earned_cents ?? 0) + (data?.adjustments_cents ?? 0);
  const given = (data?.classes ?? []).filter((c) => c.given);

  return (
    <div className="border border-border p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="eyebrow">{title}</p>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setCursor((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))}
            className="p-1.5 text-muted-foreground hover:text-foreground"
            aria-label="Mes anterior"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-[8rem] text-center text-xs capitalize">{monthLabel}</span>
          <button
            type="button"
            onClick={() => setCursor((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))}
            className="p-1.5 text-muted-foreground hover:text-foreground"
            aria-label="Mes siguiente"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {isLoading ? (
        <p className="mt-4 text-sm text-muted-foreground">Calculando…</p>
      ) : error || !data ? (
        <p className="mt-4 text-sm text-muted-foreground">No se pudo calcular la nómina.</p>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="border border-border p-3">
              <p className="text-[0.65rem] uppercase tracking-[0.1em] text-muted-foreground">
                Lo que llevo
              </p>
              <p className="mt-1 text-xl">{money(total)}</p>
            </div>
            <div className="border border-border p-3">
              <p className="text-[0.65rem] uppercase tracking-[0.1em] text-muted-foreground">
                Clases impartidas
              </p>
              <p className="mt-1 text-xl">{data.classes_given}</p>
            </div>
            <div className="border border-border p-3">
              <p className="text-[0.65rem] uppercase tracking-[0.1em] text-muted-foreground">
                {data.by_tiers ? "Pago por clase" : "Tarifa por clase"}
              </p>
              <p className="mt-1 text-xl">
                {data.by_tiers ? "Según asistencia" : money(data.rate_cents)}
              </p>
            </div>
            <div className="border border-border p-3">
              <p className="text-[0.65rem] uppercase tracking-[0.1em] text-muted-foreground">
                Por dar este mes
              </p>
              <p className="mt-1 text-xl">
                {data.classes_scheduled}{" "}
                <span className="text-sm text-muted-foreground">
                  · {money(data.projected_cents)}
                </span>
              </p>
            </div>
          </div>
          {data.adjustments_cents ? (
            <p className="mt-3 text-xs text-muted-foreground">
              Incluye ajustes de nómina por {money(data.adjustments_cents)}.
            </p>
          ) : null}
          <p className="mt-3 text-xs text-muted-foreground">
            Es un estimado con las clases que ya diste. La nómina final la cierra administración.
          </p>
          {given.length ? (
            <button
              type="button"
              onClick={() => setShowDetail((v) => !v)}
              className="mt-3 text-[0.65rem] uppercase tracking-[0.12em] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              {showDetail ? "Ocultar detalle" : "Ver detalle por clase"}
            </button>
          ) : null}
          {showDetail ? (
            <ul className="mt-3 divide-y divide-border border border-border">
              {given.map((c) => (
                <li
                  key={c.class_id}
                  className="flex items-center justify-between gap-3 px-4 py-2.5"
                >
                  <div className="min-w-0 text-sm">
                    <p className="capitalize">{classWhen(c.starts_at)}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {c.class_name ?? MODULE_LABELS[c.module_key ?? ""] ?? "Clase"} ·{" "}
                      {c.attendance} {c.attendance === 1 ? "reservación" : "reservaciones"}
                    </p>
                  </div>
                  <span className="shrink-0 text-sm tabular-nums">{money(c.pay_cents)}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
    </div>
  );
}

export function CoachProfilePanel() {
  const { staffProfile } = useAuth();

  if (!staffProfile) {
    return <p className="text-muted-foreground">Cargando tu perfil…</p>;
  }

  return (
    <div className="space-y-8">
      <CoachCreditsSection />
      <div className="border border-border p-6">
        <CoachClassesView coachId={staffProfile.id} />
      </div>
      <CoachPaySection coachId={staffProfile.id} />
      <div className="border border-border p-5 text-sm text-muted-foreground">
        <p className="eyebrow mb-2">¿Te van a cubrir una clase?</p>
        Avisa a recepción: ellos cambian el coach de esa clase y se actualiza en la página, la app y
        aquí.
      </div>
    </div>
  );
}

// ============================================================================
// CRÉDITOS SEMANALES DE COACH — cada coach puede tomar hasta N clases del
// estudio por semana (domingo a sábado). No se acumulan.
// ============================================================================

type CoachCreditBooking = {
  booking_id: string;
  class_id?: string;
  starts_at: string;
  duration_min?: number;
  seat_number?: number | null;
  module_key: string | null;
  class_name: string | null;
  coach: string | null;
  status?: string;
  checkin_status?: string | null;
};

type CoachCreditStatus = {
  limit: number;
  /** false = perfil de staff con clases semanales (no es coach). */
  is_coach?: boolean;
  week_start: string;
  used_this_week: number;
  next_week_start: string;
  used_next_week: number;
  bookings: CoachCreditBooking[];
};

const COACH_CREDIT_ERRORS: Record<string, string> = {
  CLASS_PAST: "Esa clase ya empezó; ya no se puede cancelar.",
  ALREADY_CANCELLED: "Esa reserva ya estaba cancelada.",
};

/** "2026-11-01" → Date local. */
const localDate = (ymdStr: string) => {
  const [y, m, d] = ymdStr.split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1);
};

const ymdLocal = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const sundayOfLocal = (d: Date) => {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - x.getDay());
  return x;
};

function weekRangeLabel(startYmd: string) {
  const start = localDate(startYmd);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const f = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short" });
  return `${f.format(start)} – ${f.format(end)}`;
}

const classWhen = (iso: string) =>
  new Intl.DateTimeFormat("es-MX", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));

function CreditDots({ used, limit }: { used: number; limit: number }) {
  return (
    <div className="mt-2 flex gap-1.5">
      {Array.from({ length: Math.max(limit, 0) }, (_, i) => (
        <span
          key={i}
          className={cn(
            "h-2.5 w-8",
            i < used ? "bg-foreground" : "border border-foreground/40 bg-transparent",
          )}
        />
      ))}
    </div>
  );
}

/** Sección en "Mi perfil" de la coach: sus créditos y la agenda para reservar. */
export function CoachCreditsSection() {
  const qc = useQueryClient();
  const [showSchedule, setShowSchedule] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["coach-credit-status"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("coach_credit_status");
      if (error) throw error;
      return (data as unknown as CoachCreditStatus | null) ?? null;
    },
  });

  const cancel = useMutation({
    mutationFn: async (bookingId: string) => {
      const { error } = await supabase.rpc("coach_cancel_booking", { _booking_id: bookingId });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Reserva cancelada. Tu crédito de esa semana quedó libre.");
      for (const key of ["coach-credit-status", "classes", "my-bookings"]) {
        void qc.invalidateQueries({ queryKey: [key] });
      }
    },
    onError: (e: Error) => {
      const key = Object.keys(COACH_CREDIT_ERRORS).find((k) => e.message.includes(k));
      toast.error(key ? COACH_CREDIT_ERRORS[key] : "No se pudo cancelar la reserva.");
    },
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Cargando tus créditos…</p>;
  if (!data) return null;

  const left = Math.max(data.limit - data.used_this_week, 0);
  const leftNext = Math.max(data.limit - data.used_next_week, 0);

  return (
    <div className="border border-border p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="eyebrow">
            {data.is_coach === false ? "Mis clases del estudio" : "Mis clases como coach"}
          </p>
          <p className="mt-2 max-w-xl text-sm text-muted-foreground">
            Tienes {data.limit} {data.limit === 1 ? "clase" : "clases"} por semana para tomar en el
            estudio. La semana va de domingo a sábado y las que no uses no se acumulan.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowSchedule((v) => !v)}
          className="bg-foreground px-4 py-2.5 text-[0.7rem] uppercase tracking-[0.16em] text-background"
        >
          {showSchedule ? "Ocultar horarios" : "Reservar clase"}
        </button>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <div className="border border-border p-4">
          <p className="text-[0.65rem] uppercase tracking-[0.1em] text-muted-foreground">
            Esta semana · {weekRangeLabel(data.week_start)}
          </p>
          <p className="mt-1 text-xl">
            {left} de {data.limit} disponibles
          </p>
          <CreditDots used={data.used_this_week} limit={data.limit} />
        </div>
        <div className="border border-border p-4">
          <p className="text-[0.65rem] uppercase tracking-[0.1em] text-muted-foreground">
            Próxima semana · {weekRangeLabel(data.next_week_start)}
          </p>
          <p className="mt-1 text-xl">
            {leftNext} de {data.limit} disponibles
          </p>
          <CreditDots used={data.used_next_week} limit={data.limit} />
        </div>
      </div>

      {data.bookings.length > 0 ? (
        <div className="mt-5">
          <p className="text-[0.65rem] uppercase tracking-[0.1em] text-muted-foreground">
            Mis reservas
          </p>
          <ul className="mt-2 divide-y divide-border border border-border">
            {data.bookings.map((b) => (
              <li key={b.booking_id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0 text-sm">
                  <p className="capitalize">{classWhen(b.starts_at)}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {[
                      b.class_name ?? MODULE_LABELS[b.module_key ?? ""] ?? "Clase",
                      b.coach,
                      b.seat_number ? `Lugar ${b.seat_number}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                {new Date(b.starts_at).getTime() > Date.now() ? (
                  <button
                    type="button"
                    disabled={cancel.isPending}
                    onClick={() => {
                      if (window.confirm("¿Cancelar esta reserva?")) cancel.mutate(b.booking_id);
                    }}
                    className="shrink-0 border border-input px-3 py-1.5 text-[0.62rem] uppercase tracking-[0.14em] hover:bg-foreground hover:text-background disabled:opacity-40"
                  >
                    Cancelar
                  </button>
                ) : (
                  <span className="shrink-0 text-[0.6rem] uppercase tracking-[0.14em] text-muted-foreground">
                    En curso
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {showSchedule ? (
        <div className="mt-6 border-t border-border pt-6">
          <Schedule coachMode defaultRange="semana" />
        </div>
      ) : null}
    </div>
  );
}

type CoachUsageRow = {
  staff_id: string;
  full_name: string;
  role?: string;
  active: boolean;
  has_account: boolean;
  color: string | null;
  photo_url: string | null;
  weekly_limit: number;
  used_this_week: number;
  last_used_at: string | null;
  bookings: CoachCreditBooking[];
};

const CHECKIN_LABELS: Record<string, string> = {
  a_tiempo: "Asistió",
  tarde: "Llegó tarde",
  no_show: "No llegó",
};

function usageState(periodUsed: number, limit: number) {
  if (periodUsed === 0) return { label: "Sin usar", tone: "text-muted-foreground border-border" };
  if (periodUsed >= limit)
    return { label: "Completo", tone: "text-emerald-700 border-emerald-600/40 bg-emerald-50" };
  return { label: "Parcial", tone: "text-amber-800 border-amber-500/40 bg-amber-50" };
}

/** Panel administrativo: quién usa sus créditos de coach y quién no. */
export function CoachCreditsUsagePanel() {
  const qc = useQueryClient();
  const { isAdmin } = useAuth();
  const [period, setPeriod] = useState<"semana" | "mes">("semana");
  const [anchor, setAnchor] = useState(() => new Date());
  const [showInactive, setShowInactive] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  // Perfiles del staff (no coaches) que todavía no tienen clases semanales,
  // para darlos de alta a mano desde este panel.
  const { data: candidates, isError: candidatesError } = useQuery({
    enabled: isAdmin && adding,
    queryKey: ["class-credit-candidates"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("staff_profiles")
        .select("id, full_name, role, user_id, color, photo_url")
        .eq("active", true)
        .neq("role", "coach")
        .eq("class_credits_enabled", false)
        .order("full_name");
      if (error) throw error;
      return data;
    },
  });

  const setEnabled = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const { error } = await supabase
        .from("staff_profiles")
        .update({ class_credits_enabled: enabled })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      toast.success(
        v.enabled
          ? "Perfil agregado: ya tiene sus clases semanales."
          : "Perfil quitado de la lista.",
      );
      void qc.invalidateQueries({ queryKey: ["coach-credit-usage"] });
      void qc.invalidateQueries({ queryKey: ["class-credit-candidates"] });
    },
    onError: () => toast.error("No se pudo guardar el cambio."),
  });

  const range = useMemo(() => {
    if (period === "semana") {
      const from = sundayOfLocal(anchor);
      const to = new Date(from);
      to.setDate(to.getDate() + 6);
      return { from, to, weeks: 1 };
    }
    const from = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const to = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
    // Semanas (domingo a sábado) que tocan el mes.
    const weeks =
      Math.round((sundayOfLocal(to).getTime() - sundayOfLocal(from).getTime()) / 6048e5) + 1;
    return { from, to, weeks };
  }, [period, anchor]);

  const { data, isLoading } = useQuery({
    queryKey: ["coach-credit-usage", ymdLocal(range.from), ymdLocal(range.to)],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("coach_credit_usage", {
        _from: ymdLocal(range.from),
        _to: ymdLocal(range.to),
      });
      if (error) throw error;
      return (data as unknown as CoachUsageRow[] | null) ?? [];
    },
  });

  const saveLimit = useMutation({
    mutationFn: async ({ id, value }: { id: string; value: number }) => {
      const { error } = await supabase
        .from("staff_profiles")
        .update({ weekly_class_credits: value })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Créditos semanales actualizados.");
      void qc.invalidateQueries({ queryKey: ["coach-credit-usage"] });
    },
    onError: () => toast.error("No se pudo guardar. Usa un número entre 0 y 14."),
  });

  const shift = (dir: -1 | 1) =>
    setAnchor((a) =>
      period === "semana"
        ? new Date(a.getFullYear(), a.getMonth(), a.getDate() + dir * 7)
        : new Date(a.getFullYear(), a.getMonth() + dir, 1),
    );

  const rows = (data ?? [])
    .filter((r) => showInactive || r.active)
    .map((r) => {
      const used = r.bookings.filter((b) => b.status === "reservada");
      const periodLimit = r.weekly_limit * range.weeks;
      return {
        ...r,
        used,
        periodLimit,
        attended: used.filter(
          (b) => b.checkin_status === "a_tiempo" || b.checkin_status === "tarde",
        ).length,
        cancelled: r.bookings.filter((b) => b.status === "cancelada").length,
      };
    })
    .sort((a, b) => b.used.length - a.used.length || a.full_name.localeCompare(b.full_name, "es"));

  const usedCoaches = rows.filter((r) => r.used.length > 0).length;
  const totalUsed = rows.reduce((acc, r) => acc + r.used.length, 0);
  const totalAvailable = rows.reduce((acc, r) => acc + r.periodLimit, 0);

  const periodLabel =
    period === "semana"
      ? weekRangeLabel(ymdLocal(range.from))
      : new Intl.DateTimeFormat("es-MX", { month: "long", year: "numeric" }).format(range.from);

  const opened = rows.find((r) => r.staff_id === openId) ?? null;

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-xs text-muted-foreground">
          Cada coach (y los perfiles de staff que agregues) tiene clases de cortesía por semana
          (domingo a sábado) que reserva desde su perfil o su inicio. No se acumulan: lo que no se
          usa en la semana se pierde.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {(["semana", "mes"] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPeriod(p)}
              className={cn(
                "border px-3 py-1.5 text-[0.65rem] uppercase tracking-[0.12em]",
                period === p ? "border-foreground bg-foreground text-background" : "border-input",
              )}
            >
              {p === "semana" ? "Semana" : "Mes"}
            </button>
          ))}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => shift(-1)}
              className="p-1.5 text-muted-foreground hover:text-foreground"
              aria-label="Anterior"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="min-w-[9rem] text-center text-xs capitalize">{periodLabel}</span>
            <button
              type="button"
              onClick={() => shift(1)}
              className="p-1.5 text-muted-foreground hover:text-foreground"
              aria-label="Siguiente"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          {isAdmin ? (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="bg-foreground px-3 py-1.5 text-[0.65rem] uppercase tracking-[0.12em] text-background"
            >
              + Agregar perfil
            </button>
          ) : null}
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
            />
            Ver inactivas
          </label>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ["Perfiles", rows.length],
          ["Lo usaron", usedCoaches],
          ["No lo usaron", rows.length - usedCoaches],
          ["Clases usadas", `${totalUsed} de ${totalAvailable}`],
        ].map(([label, value]) => (
          <div key={String(label)} className="border border-border p-3">
            <p className="text-[0.65rem] uppercase tracking-[0.1em] text-muted-foreground">
              {label}
            </p>
            <p className="mt-1 text-xl">{value}</p>
          </div>
        ))}
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sin perfiles dados de alta.</p>
      ) : (
        <div className="overflow-x-auto border border-border">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-[0.65rem] uppercase tracking-[0.1em] text-muted-foreground">
                <th className="px-3 py-2">Perfil</th>
                <th className="px-3 py-2">Estado</th>
                <th className="px-3 py-2">Usadas en el periodo</th>
                <th className="px-3 py-2">Esta semana</th>
                <th className="px-3 py-2">Asistió</th>
                <th className="px-3 py-2">Último uso</th>
                <th className="px-3 py-2">Por semana</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const state = usageState(r.used.length, r.periodLimit);
                return (
                  <tr
                    key={r.staff_id}
                    className={cn(
                      "border-b border-border last:border-0",
                      !r.active && "opacity-50",
                    )}
                  >
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => setOpenId(r.staff_id)}
                        className="flex items-center gap-2 text-left hover:underline"
                      >
                        <Avatar className="h-7 w-7">
                          {r.photo_url ? <AvatarImage src={r.photo_url} alt="" /> : null}
                          <AvatarFallback
                            className="text-[0.6rem]"
                            style={coachSwatch(normalizeHex(r.color))}
                          >
                            {initials(r.full_name)}
                          </AvatarFallback>
                        </Avatar>
                        <span>{r.full_name}</span>
                      </button>
                      {r.role && r.role !== "coach" ? (
                        <span className="mt-0.5 flex items-center gap-2 text-[0.6rem] uppercase tracking-[0.1em] text-muted-foreground">
                          {TEAM_ROLE_LABELS[r.role] ?? r.role}
                          {isAdmin ? (
                            <button
                              type="button"
                              disabled={setEnabled.isPending}
                              onClick={() => {
                                if (
                                  window.confirm(
                                    `¿Quitar a ${r.full_name} de las clases semanales? Sus reservas ya hechas se quedan.`,
                                  )
                                )
                                  setEnabled.mutate({ id: r.staff_id, enabled: false });
                              }}
                              className="normal-case tracking-normal text-destructive hover:underline"
                            >
                              Quitar
                            </button>
                          ) : null}
                        </span>
                      ) : null}
                      {!r.has_account ? (
                        <span className="block text-[0.6rem] text-amber-700">
                          Sin acceso al sistema
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={cn("border px-2 py-0.5 text-[0.62rem] uppercase", state.tone)}
                      >
                        {state.label}
                      </span>
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      {r.used.length} de {r.periodLimit}
                      {r.cancelled ? (
                        <span className="text-xs text-muted-foreground">
                          {" "}
                          · {r.cancelled} cancel.
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      {r.used_this_week} de {r.weekly_limit}
                    </td>
                    <td className="px-3 py-2 tabular-nums">{r.attended}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {r.last_used_at ? classWhen(r.last_used_at) : "Nunca"}
                    </td>
                    <td className="px-3 py-2">
                      {isAdmin ? (
                        <input
                          type="number"
                          min={0}
                          max={14}
                          defaultValue={r.weekly_limit}
                          key={`${r.staff_id}-${r.weekly_limit}`}
                          onBlur={(e) => {
                            const value = Number(e.target.value);
                            if (Number.isInteger(value) && value !== r.weekly_limit)
                              saveLimit.mutate({ id: r.staff_id, value });
                          }}
                          className={`${input} w-16`}
                          aria-label={`Clases por semana de ${r.full_name}`}
                        />
                      ) : (
                        r.weekly_limit
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {adding ? (
        <Popout onClose={() => setAdding(false)}>
          <p className="text-lg">Agregar perfil</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Elige quién del staff tendrá clases semanales (empieza con 2; lo puedes cambiar en la
            columna "Por semana").
          </p>
          {candidatesError ? (
            <p className="mt-6 text-sm text-destructive">
              No se pudo cargar la lista del staff. Cierra y vuelve a intentar; si sigue, avisa a
              soporte.
            </p>
          ) : !candidates ? (
            <p className="mt-6 text-sm text-muted-foreground">Cargando…</p>
          ) : candidates.length === 0 ? (
            <p className="mt-6 text-sm text-muted-foreground">
              Todo el staff activo ya está en la lista. Para alguien nuevo, primero dalo de alta en
              Staff.
            </p>
          ) : (
            <ul className="mt-5 max-h-[60vh] divide-y divide-border overflow-y-auto border border-border">
              {candidates.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <Avatar className="h-7 w-7">
                      {c.photo_url ? <AvatarImage src={c.photo_url} alt="" /> : null}
                      <AvatarFallback
                        className="text-[0.6rem]"
                        style={coachSwatch(normalizeHex(c.color))}
                      >
                        {initials(c.full_name)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="truncate text-sm">{c.full_name}</p>
                      <p className="text-[0.62rem] uppercase tracking-[0.1em] text-muted-foreground">
                        {TEAM_ROLE_LABELS[c.role] ?? c.role}
                        {!c.user_id ? " · sin acceso al sistema" : ""}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={setEnabled.isPending}
                    onClick={() => setEnabled.mutate({ id: c.id, enabled: true })}
                    className="shrink-0 border border-foreground px-3 py-1.5 text-[0.62rem] uppercase tracking-[0.14em] hover:bg-foreground hover:text-background disabled:opacity-40"
                  >
                    Agregar
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Popout>
      ) : null}

      {opened ? (
        <Popout onClose={() => setOpenId(null)}>
          <p className="text-lg">{opened.full_name}</p>
          <p className="text-xs capitalize text-muted-foreground">{periodLabel}</p>
          {opened.bookings.length === 0 ? (
            <p className="mt-6 text-sm text-muted-foreground">
              No reservó clases con su crédito en este periodo.
            </p>
          ) : (
            <ul className="mt-5 divide-y divide-border border border-border">
              {opened.bookings.map((b) => (
                <li
                  key={b.booking_id}
                  className="flex items-center justify-between gap-3 px-4 py-3"
                >
                  <div className="min-w-0 text-sm">
                    <p className="capitalize">{classWhen(b.starts_at)}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {[b.class_name ?? MODULE_LABELS[b.module_key ?? ""] ?? "Clase", b.coach]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <span className="shrink-0 text-[0.62rem] uppercase tracking-[0.12em] text-muted-foreground">
                    {b.status === "cancelada"
                      ? "Canceló"
                      : b.checkin_status
                        ? (CHECKIN_LABELS[b.checkin_status] ?? b.checkin_status)
                        : new Date(b.starts_at).getTime() > Date.now()
                          ? "Reservada"
                          : "Sin check-in"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Popout>
      ) : null}
    </div>
  );
}
