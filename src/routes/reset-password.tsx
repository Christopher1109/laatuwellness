import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { BrandLink } from "@/components/brand";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Restablecer contraseña — Läätu Wellness" },
      {
        name: "description",
        content: "Define una nueva contraseña para tu cuenta de Läätu Wellness.",
      },
      { property: "og:title", content: "Restablecer contraseña — Läätu Wellness" },
      { property: "og:description", content: "Define una nueva contraseña." },
    ],
  }),
  component: ResetPassword,
});

function ResetPassword() {
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const password = String(new FormData(e.currentTarget).get("password") ?? "");
    if (password.length < 8) {
      toast.error("Mínimo 8 caracteres");
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Contraseña actualizada.");
    navigate({ to: "/cuenta" });
  };

  return (
    <div className="flex min-h-screen flex-col justify-center px-5 py-16">
      <div className="mx-auto w-full max-w-sm">
        <BrandLink />
        <h1 className="statement mt-10 text-3xl">Nueva contraseña</h1>
        <form onSubmit={submit} className="mt-8 space-y-5">
          <div>
            <label htmlFor="password" className="eyebrow">Contraseña</label>
            <input
              id="password"
              name="password"
              type="password"
              required
              minLength={8}
              maxLength={72}
              className="mt-2 w-full border border-input bg-transparent px-4 py-3 text-sm outline-none focus:border-foreground"
            />
          </div>
          <button
            type="submit"
            disabled={busy}
            className="w-full bg-foreground px-7 py-3.5 text-[0.72rem] uppercase tracking-[0.18em] text-background disabled:opacity-50"
          >
            {busy ? "Guardando…" : "Guardar"}
          </button>
        </form>
      </div>
    </div>
  );
}
