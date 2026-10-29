import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Clock, KeyRound, MapPin, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import { coachSwatch, normalizeHex } from "@/lib/coach-colors";
import type { TeamRole } from "@/lib/team-member";
import { saveTeamMember } from "@/utils/team-admin.functions";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Popout, input } from "@/components/admin/ops-panels";

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
              typeName={c.class_type_id ? classTypes?.get(c.class_type_id) : undefined}
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
          typeName={rosterFor.class_type_id ? classTypes?.get(rosterFor.class_type_id) : undefined}
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
                    <li key={p.booking_id} className="flex items-center justify-between gap-3 py-2">
                      <span className="flex min-w-0 items-center gap-2">
                        {p.seat_number ? (
                          <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-foreground text-[0.6rem] text-background">
                            {p.seat_number}
                          </span>
                        ) : null}
                        <span className="truncate">{p.full_name || "Sin nombre"}</span>
                      </span>
                      {status === "reservada" && p.checked_in ? (
                        <span className="shrink-0 bg-emerald-500/10 px-1.5 py-0.5 text-[0.6rem] text-emerald-700">
                          Llegó
                        </span>
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
export function CoachProfilePanel() {
  const { staffProfile } = useAuth();

  const monthStart = useMemo(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  }, []);

  const { data: monthSeconds } = useQuery({
    queryKey: ["coach-month-seconds", staffProfile?.id],
    enabled: Boolean(staffProfile),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("staff_worked_seconds", {
        _staff_id: staffProfile!.id,
        _from: monthStart.toISOString(),
        _to: new Date().toISOString(),
      });
      if (error) throw error;
      return data ?? 0;
    },
  });

  if (!staffProfile) {
    return <p className="text-muted-foreground">Cargando tu perfil…</p>;
  }

  const monthEarnings = ((monthSeconds ?? 0) / 3600) * (staffProfile.hourly_rate_cents ?? 0);

  return (
    <div className="space-y-8">
      <div className="border border-border p-6">
        <CoachClassesView coachId={staffProfile.id} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="border border-border p-5">
          <p className="eyebrow">Lo que llevo del mes</p>
          <p className="mt-2 text-2xl">{money(monthEarnings)}</p>
          <p className="text-sm text-muted-foreground">
            {((monthSeconds ?? 0) / 3600).toFixed(1)} horas registradas en el checador
          </p>
        </div>
        <div className="border border-border p-5 text-sm text-muted-foreground">
          <p className="eyebrow mb-2">¿Te van a cubrir una clase?</p>
          Avisa a recepción: ellos cambian el coach de esa clase y se actualiza en la página, la app
          y aquí.
        </div>
      </div>
    </div>
  );
}
