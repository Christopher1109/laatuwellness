import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { BrandLink } from "@/components/brand";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Entrar o crear cuenta — Läätu Wellness" },
      {
        name: "description",
        content:
          "Crea tu cuenta Läätu para comprar tokens, firmar tu waiver y reservar tus clases.",
      },
      { property: "og:title", content: "Entrar o crear cuenta — Läätu Wellness" },
      {
        property: "og:description",
        content: "Accede a tu cuenta Läätu Wellness.",
      },
    ],
  }),
  component: Auth,
});

const signUpSchema = z.object({
  full_name: z.string().trim().min(2, "Escribe tu nombre").max(100),
  email: z.string().trim().email("Correo inválido").max(255),
  phone: z.string().trim().min(10, "Escribe un número a 10 dígitos").max(30),
  password: z.string().min(8, "Mínimo 8 caracteres").max(72),
});

const signInSchema = z.object({
  email: z.string().trim().email("Correo inválido").max(255),
  password: z.string().min(1, "Escribe tu contraseña").max(72),
});

type Mode = "in" | "up" | "forgot";

// Si el correo con el que se inicia sesión pertenece a un usuario
// administrativo/operativo (staff_profiles), lo mandamos a la zona
// administrativa en lugar de la zona de cliente ("/cuenta").
async function resolveLandingRoute(userId: string | undefined): Promise<"/admin" | "/cuenta"> {
  if (!userId) return "/cuenta";
  const { data } = await supabase
    .from("staff_profiles")
    .select("id")
    .eq("user_id", userId)
    .eq("active", true)
    .maybeSingle();
  return data ? "/admin" : "/cuenta";
}

function Auth() {
  const [mode, setMode] = useState<Mode>("in");
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const field =
    "mt-2 w-full border border-input bg-transparent px-4 py-3 text-sm outline-none transition-colors focus:border-foreground";

  const handle = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    try {
      if (mode === "up") {
        const parsed = signUpSchema.safeParse({
          full_name: form.get("full_name"),
          email: form.get("email"),
          phone: form.get("phone"),
          password: form.get("password"),
        });
        if (!parsed.success) {
          toast.error(parsed.error.issues[0]?.message ?? "Revisa los datos");
          return;
        }
        const { data, error } = await supabase.auth.signUp({
          email: parsed.data.email,
          password: parsed.data.password,
          options: {
            emailRedirectTo: window.location.origin,
            data: {
              full_name: parsed.data.full_name,
              phone: parsed.data.phone || null,
            },
          },
        });
        if (error) throw error;
        if (data.session) {
          navigate({ to: await resolveLandingRoute(data.user?.id) });
        } else {
          toast.success("Revisa tu correo para confirmar tu cuenta.");
        }
        return;
      }

      if (mode === "forgot") {
        const email = String(form.get("email") ?? "").trim();
        if (!z.string().email().safeParse(email).success) {
          toast.error("Correo inválido");
          return;
        }
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (error) throw error;
        toast.success("Te enviamos un enlace para restablecer tu contraseña.");
        setMode("in");
        return;
      }

      const parsed = signInSchema.safeParse({
        email: form.get("email"),
        password: form.get("password"),
      });
      if (!parsed.success) {
        toast.error(parsed.error.issues[0]?.message ?? "Revisa los datos");
        return;
      }
      const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
      if (error) throw error;
      navigate({ to: await resolveLandingRoute(data.user?.id) });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Algo salió mal");
    } finally {
      setBusy(false);
    }
  };

  const google = async () => {
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (result.error) {
      toast.error("No pudimos iniciar sesión con Google.");
      return;
    }
    if (result.redirected) return;
    const { data: userData } = await supabase.auth.getUser();
    navigate({ to: await resolveLandingRoute(userData.user?.id) });
  };

  return (
    <div className="grid min-h-screen md:grid-cols-2">
      <div className="surface-dark constellation grain hidden flex-col justify-between p-12 md:flex">
        <div className="relative z-[2]">
          <BrandLink />
        </div>
        <div className="relative z-[2]">
          <h1 className="statement text-[clamp(2rem,4vw,3.2rem)]">
            Abraza el caos, es tu mejor amigo.
          </h1>
          <p className="mt-6 max-w-sm text-muted-foreground">
            Tu cuenta guarda tus tokens, tu waiver y tu historial de reservas.
          </p>
        </div>
        <p className="relative z-[2] eyebrow">Wellness Recovery Bar</p>
      </div>

      <div className="flex flex-col justify-center px-5 py-16 sm:px-12">
        <div className="mx-auto w-full max-w-sm">
          <div className="md:hidden">
            <BrandLink />
          </div>
          <h2 className="statement mt-10 text-3xl md:mt-0">
            {mode === "up"
              ? "Crea tu cuenta"
              : mode === "forgot"
                ? "Recupera tu acceso"
                : "Bienvenida de vuelta"}
          </h2>

          <form onSubmit={handle} className="mt-8 space-y-5">
            {mode === "up" ? (
              <>
                <div>
                  <label htmlFor="full_name" className="eyebrow">
                    Nombre completo
                  </label>
                  <input
                    id="full_name"
                    name="full_name"
                    required
                    maxLength={100}
                    className={field}
                  />
                </div>
                <div>
                  <label htmlFor="phone" className="eyebrow">
                    Teléfono
                  </label>
                  <input
                    id="phone"
                    name="phone"
                    type="tel"
                    required
                    minLength={10}
                    maxLength={30}
                    placeholder="81 1234 5678"
                    className={field}
                  />
                </div>
              </>
            ) : null}

            <div>
              <label htmlFor="email" className="eyebrow">
                Correo
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                maxLength={255}
                className={field}
              />
            </div>

            {mode !== "forgot" ? (
              <div>
                <label htmlFor="password" className="eyebrow">
                  Contraseña
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  required
                  minLength={mode === "up" ? 8 : 1}
                  maxLength={72}
                  className={field}
                />
              </div>
            ) : null}

            <button
              type="submit"
              disabled={busy}
              className="w-full bg-foreground px-7 py-3.5 text-[0.72rem] uppercase tracking-[0.18em] text-background transition-opacity hover:opacity-85 disabled:opacity-50"
            >
              {busy
                ? "Un momento…"
                : mode === "up"
                  ? "Crear cuenta"
                  : mode === "forgot"
                    ? "Enviar enlace"
                    : "Entrar"}
            </button>
          </form>

          {mode !== "forgot" ? (
            <>
              <div className="my-6 flex items-center gap-4 text-xs text-muted-foreground">
                <span className="rule-line flex-1" />o<span className="rule-line flex-1" />
              </div>
              <button
                onClick={google}
                className="w-full border border-input px-7 py-3.5 text-[0.72rem] uppercase tracking-[0.18em] transition-colors hover:border-foreground"
              >
                Continuar con Google
              </button>
            </>
          ) : null}

          <div className="mt-8 space-y-2 text-sm text-muted-foreground">
            {mode === "in" ? (
              <>
                <p>
                  ¿Aún no tienes cuenta?{" "}
                  <button
                    onClick={() => setMode("up")}
                    className="border-b border-foreground pb-0.5 text-foreground"
                  >
                    Regístrate
                  </button>
                </p>
                <p>
                  <button
                    onClick={() => setMode("forgot")}
                    className="border-b border-border pb-0.5"
                  >
                    Olvidé mi contraseña
                  </button>
                </p>
              </>
            ) : (
              <p>
                <button
                  onClick={() => setMode("in")}
                  className="border-b border-foreground pb-0.5 text-foreground"
                >
                  Volver a iniciar sesión
                </button>
              </p>
            )}
            <p>
              <Link to="/" className="border-b border-border pb-0.5">
                Volver al inicio
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
