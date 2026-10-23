import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { performAdminPasswordReset, validatePasswordReset, type PasswordResetInput } from "@/lib/admin-password-reset";

export const resetUserPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: PasswordResetInput) => validatePasswordReset(input))
  .handler(async ({ data, context }) => {
    return performAdminPasswordReset(data, {
      isAdministrator: async () => {
        const { data: allowed, error } = await context.supabase.rpc("has_role", {
          _user_id: context.userId,
          _role: "admin",
        });
        return !error && allowed === true;
      },
      resolveUserId: async (input) => {
        // Privileged imports are reached only after the caller's role is verified.
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        if (input.targetKind === "staff") {
          const { data: profile, error } = await supabaseAdmin.from("staff_profiles")
            .select("user_id").eq("id", input.targetId).maybeSingle();
          if (error) throw new Error("No se pudo consultar el usuario.");
          return profile?.user_id ?? null;
        }
        const { data: profile, error } = await supabaseAdmin.from("profiles")
          .select("id").eq("id", input.targetId).maybeSingle();
        if (error) throw new Error("No se pudo consultar el usuario.");
        return profile?.id ?? null;
      },
      updatePassword: async (userId, password) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, { password });
        return !error;
      },
    });
  });