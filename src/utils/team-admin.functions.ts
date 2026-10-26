import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { describeError } from "@/lib/describe-error";
import { validateTeamMember, type TeamMemberInput } from "@/lib/team-member";

const TEAM_ROLES = ["admin", "staff", "coach"] as const;

/**
 * Alta / edición de staff y coaches desde el panel, incluyendo su acceso:
 * correo + contraseña se guardan directo en la cuenta (sin mandar correos de
 * confirmación ni de recuperación). Solo administración puede usarla.
 */
export const saveTeamMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: Partial<TeamMemberInput>) => validateTeamMember(input))
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (isAdmin !== true) throw new Error("Solo un administrador puede editar al equipo.");

    // El cliente privilegiado se carga solo después de validar el rol.
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");

    if (data.email) {
      let dupQuery = admin.from("staff_profiles").select("id").ilike("email", data.email).limit(1);
      if (data.id) dupQuery = dupQuery.neq("id", data.id);
      const { data: dup, error: dupError } = await dupQuery;
      if (dupError) throw new Error(describeError(dupError));
      if (dup && dup.length > 0) throw new Error("Ese correo ya lo usa otra persona del equipo.");
    }

    const fields = {
      full_name: data.fullName,
      email: data.email,
      phone: data.phone,
      photo_url: data.photoUrl,
      role: data.role,
      hourly_rate_cents: data.hourlyRateCents,
      active: data.active,
      color: data.color,
    };

    let profile: { id: string; user_id: string | null };
    if (data.id) {
      const { data: updated, error } = await admin
        .from("staff_profiles")
        .update(fields)
        .eq("id", data.id)
        .select("id, user_id")
        .maybeSingle();
      if (error) throw new Error(describeError(error, "No se pudo guardar el perfil."));
      if (!updated) throw new Error("No se encontró el perfil.");
      profile = updated;
    } else {
      const { data: created, error } = await admin
        .from("staff_profiles")
        .insert(fields)
        .select("id, user_id")
        .single();
      if (error) throw new Error(describeError(error, "No se pudo crear el perfil."));
      profile = created;
    }

    let userId = profile.user_id;
    let createdNow = false;

    // Sin cuenta vinculada: se reutiliza la cuenta que ya tenga ese correo
    // (por ejemplo, una coach que también es clienta) o se crea una nueva
    // con la contraseña indicada, ya confirmada.
    if (!userId && data.email) {
      const { data: existing } = await admin
        .from("profiles")
        .select("id")
        .ilike("email", data.email)
        .limit(1);
      const existingId = existing?.[0]?.id ?? null;
      if (existingId) {
        const { data: other } = await admin
          .from("staff_profiles")
          .select("id")
          .eq("user_id", existingId)
          .neq("id", profile.id)
          .limit(1);
        if (other && other.length > 0) {
          throw new Error("Esa cuenta ya está vinculada a otra persona del equipo.");
        }
        userId = existingId;
      } else if (data.password) {
        const { data: createdUser, error } = await admin.auth.admin.createUser({
          email: data.email,
          password: data.password,
          email_confirm: true,
          user_metadata: { full_name: data.fullName },
        });
        if (error || !createdUser.user) {
          throw new Error(describeError(error, "No se pudo crear el acceso."));
        }
        userId = createdUser.user.id;
        createdNow = true;
      }
      if (userId) {
        const { error } = await admin
          .from("staff_profiles")
          .update({ user_id: userId })
          .eq("id", profile.id);
        if (error) throw new Error(describeError(error, "No se pudo vincular el acceso."));
      }
    }

    if (userId) {
      // Correo y contraseña de la cuenta coinciden con lo que se ve en el panel.
      const { data: authUser } = await admin.auth.admin.getUserById(userId);
      const patch: { email?: string; email_confirm?: boolean; password?: string } = {};
      if (data.email && authUser.user?.email?.toLowerCase() !== data.email) {
        patch.email = data.email;
        patch.email_confirm = true;
      }
      if (data.password && !createdNow) patch.password = data.password;
      if (Object.keys(patch).length > 0) {
        const { error } = await admin.auth.admin.updateUserById(userId, patch);
        if (error) {
          throw new Error(
            describeError(
              error,
              "No se pudo actualizar el acceso. Revisa el correo y la contraseña.",
            ),
          );
        }
      }
      if (patch.email) {
        await admin.from("profiles").update({ email: data.email }).eq("id", userId);
      }

      // El rol del panel manda: se quita el rol de equipo anterior y se deja
      // el actual. Nunca se le quita su propio rol a quien está editando.
      if (userId !== context.userId) {
        const stale = TEAM_ROLES.filter((r) => r !== data.role);
        const { error: delError } = await admin
          .from("user_roles")
          .delete()
          .eq("user_id", userId)
          .in("role", stale);
        if (delError) throw new Error(describeError(delError));
      }
      const { error: roleError } = await admin
        .from("user_roles")
        .upsert(
          { user_id: userId, role: data.role },
          { onConflict: "user_id,role", ignoreDuplicates: true },
        );
      if (roleError) throw new Error(describeError(roleError));
    }

    return { ok: true as const, id: profile.id, hasAccess: Boolean(userId) };
  });
