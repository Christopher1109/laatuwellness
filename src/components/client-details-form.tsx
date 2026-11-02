import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { describeError } from "@/lib/describe-error";

function todayIso() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Monterrey" }).format(new Date());
}

/**
 * Cumpleaños y notas de salud (lesiones, embarazo…). Las notas las ve la
 * coach en la lista de su clase. Lo usan la clienta en "Mi cuenta" y
 * recepción/administración en la ficha del cliente.
 */
export function ClientDetailsForm({
  userId,
  birthDate,
  healthNotes,
  invalidateKeys,
  variant = "client",
}: {
  userId: string;
  birthDate: string | null | undefined;
  healthNotes: string | null | undefined;
  invalidateKeys: unknown[][];
  variant?: "client" | "staff";
}) {
  const qc = useQueryClient();
  const [bd, setBd] = useState(birthDate ?? "");
  const [notes, setNotes] = useState(healthNotes ?? "");

  useEffect(() => setBd(birthDate ?? ""), [birthDate]);
  useEffect(() => setNotes(healthNotes ?? ""), [healthNotes]);

  const dirty = bd !== (birthDate ?? "") || notes.trim() !== (healthNotes ?? "").trim();

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("set_client_details", {
        _user_id: userId,
        _birth_date: bd || null,
        _health_notes: notes.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Datos guardados.");
      for (const key of invalidateKeys) void qc.invalidateQueries({ queryKey: key });
    },
    onError: (e) => toast.error(describeError(e, "No se pudieron guardar los datos.")),
  });

  const field =
    "mt-2 w-full border border-input bg-transparent px-4 py-3 text-sm outline-none transition-colors focus:border-foreground";

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
      className="space-y-5"
    >
      <label className="block">
        <span className="eyebrow">Fecha de nacimiento</span>
        <input
          type="date"
          value={bd}
          min="1900-01-01"
          max={todayIso()}
          onChange={(e) => setBd(e.target.value)}
          className={`${field} max-w-xs`}
        />
      </label>
      <label className="block">
        <span className="eyebrow">Lesiones, embarazo o algo que tu coach deba saber</span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={500}
          rows={3}
          placeholder={
            variant === "client"
              ? "Ej. Lesión en rodilla izquierda, embarazo de 12 semanas…"
              : "Lo que la coach debe saber antes de la clase"
          }
          className={field}
        />
        <span className="mt-1.5 block text-xs text-muted-foreground">
          Solo lo ven las coaches de las clases que reservas y el equipo del estudio.
        </span>
      </label>
      <button
        type="submit"
        disabled={!dirty || save.isPending}
        className="bg-foreground px-6 py-3 text-[0.7rem] uppercase tracking-[0.18em] text-background disabled:opacity-40"
      >
        Guardar
      </button>
    </form>
  );
}
