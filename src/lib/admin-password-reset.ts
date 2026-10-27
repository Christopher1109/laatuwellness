export type PasswordResetInput = {
  targetId: string;
  targetKind: "staff" | "client";
  password: string;
};

export function validatePasswordReset(input: PasswordResetInput): PasswordResetInput {
  if (
    !input ||
    !/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(input.targetId)
  ) {
    throw new Error("Usuario inválido.");
  }
  if (input.targetKind !== "staff" && input.targetKind !== "client") {
    throw new Error("Usuario inválido.");
  }
  if (
    typeof input.password !== "string" ||
    input.password.length < 8 ||
    input.password.length > 72
  ) {
    throw new Error("La contraseña debe tener entre 8 y 72 caracteres.");
  }
  return { targetId: input.targetId, targetKind: input.targetKind, password: input.password };
}

type ResetDependencies = {
  isAdministrator: () => Promise<boolean>;
  resolveUserId: (input: PasswordResetInput) => Promise<string | null>;
  updatePassword: (userId: string, password: string) => Promise<boolean>;
};

export async function performAdminPasswordReset(
  input: PasswordResetInput,
  deps: ResetDependencies,
) {
  if (!(await deps.isAdministrator())) {
    throw new Error("Solo un administrador puede restablecer contraseñas.");
  }
  const data = validatePasswordReset(input);
  const userId = await deps.resolveUserId(data);
  if (!userId) {
    throw new Error("Este perfil no tiene una cuenta de acceso vinculada.");
  }
  if (!(await deps.updatePassword(userId, data.password))) {
    throw new Error(
      "No se pudo actualizar la contraseña. Revisa que cumpla los requisitos de seguridad.",
    );
  }
  return { ok: true as const };
}
