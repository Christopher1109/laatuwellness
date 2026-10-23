import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { describeError } from "@/lib/describe-error";

const UUID = /^[a-f0-9-]{36}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type AuthedContext = {
  userId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- cliente tipado por el middleware
  supabase: any;
};

// Solo un administrador puede editar o borrar clientes, y nunca sobre una
// cuenta del staff ni sobre su propia cuenta.
async function assertCanManageClient(context: AuthedContext, clientId: string) {
  const { data: isAdmin } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (!isAdmin) throw new Error("Solo un administrador puede modificar clientes.");
  if (clientId === context.userId)
    throw new Error("No puedes modificar tu propia cuenta desde aquí.");

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const [{ data: staff }, { data: targetIsAdmin }] = await Promise.all([
    supabaseAdmin.from("staff_profiles").select("id").eq("user_id", clientId).maybeSingle(),
    supabaseAdmin.rpc("has_role", { _user_id: clientId, _role: "admin" }),
  ]);
  if (staff || targetIsAdmin) {
    throw new Error("Esta cuenta pertenece al staff; edítala desde el módulo de Staff.");
  }
  return supabaseAdmin;
}

// Edita nombre, correo y teléfono del cliente. El correo se cambia también en
// su cuenta de acceso, para que siga entrando con el correo que ve el staff.
export const updateClientProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { clientId: string; fullName: string; email: string; phone: string }) => {
    if (!UUID.test(data.clientId)) throw new Error("Cliente inválido.");
    const fullName = String(data.fullName ?? "")
      .trim()
      .slice(0, 120);
    const email = String(data.email ?? "")
      .trim()
      .toLowerCase()
      .slice(0, 200);
    const phone = String(data.phone ?? "")
      .replace(/[^\d+\s()-]/g, "")
      .trim()
      .slice(0, 30);
    if (!fullName) throw new Error("El nombre no puede ir vacío.");
    if (!EMAIL.test(email)) throw new Error("El correo no es válido.");
    return { clientId: data.clientId, fullName, email, phone };
  })
  .handler(async ({ data, context }) => {
    const admin = await assertCanManageClient(context as AuthedContext, data.clientId);

    const { data: current, error: currentError } = await admin
      .from("profiles")
      .select("email")
      .eq("id", data.clientId)
      .single();
    if (currentError || !current) throw new Error("Cliente no encontrado.");

    if (current.email.toLowerCase() !== data.email) {
      const { data: taken } = await admin
        .from("profiles")
        .select("id")
        .ilike("email", data.email)
        .neq("id", data.clientId)
        .limit(1);
      if (taken && taken.length > 0) throw new Error("Ese correo ya lo usa otra cuenta.");

      const { error: authError } = await admin.auth.admin.updateUserById(data.clientId, {
        email: data.email,
        email_confirm: true,
      });
      if (authError) throw new Error(describeError(authError, "No se pudo cambiar el correo."));
    }

    const { error } = await admin
      .from("profiles")
      .update({ full_name: data.fullName, email: data.email, phone: data.phone || null })
      .eq("id", data.clientId);
    if (error) throw new Error(describeError(error, "No se pudieron guardar los cambios."));
    return { ok: true };
  });

// Borra al cliente por completo (cuenta, reservaciones, créditos, notas).
// Si ya tiene pagos completados no se borra: esas ventas forman parte de las
// finanzas y del corte del estudio, y se perderían junto con la cuenta.
export const deleteClient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { clientId: string }) => {
    if (!UUID.test(data.clientId)) throw new Error("Cliente inválido.");
    return { clientId: data.clientId };
  })
  .handler(async ({ data, context }) => {
    const admin = await assertCanManageClient(context as AuthedContext, data.clientId);

    const { count, error: countError } = await admin
      .from("transactions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", data.clientId)
      .eq("status", "completed");
    if (countError) throw new Error(describeError(countError));
    if ((count ?? 0) > 0) {
      throw new Error(
        "Este cliente tiene compras pagadas; borrarlo eliminaría esas ventas de las finanzas. Puedes editar sus datos en su lugar.",
      );
    }

    const { error } = await admin.auth.admin.deleteUser(data.clientId);
    if (error) throw new Error(describeError(error, "No se pudo borrar al cliente."));
    return { ok: true };
  });
