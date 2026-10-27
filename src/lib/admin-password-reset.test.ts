import { describe, expect, it, vi } from "vitest";
import {
  performAdminPasswordReset,
  validatePasswordReset,
  type PasswordResetInput,
} from "./admin-password-reset";

const input: PasswordResetInput = {
  targetId: "00000000-0000-4000-8000-000000000001",
  targetKind: "staff",
  password: "synthetic-test-only",
};

describe("administrator password reset", () => {
  it("blocks staff and clients before accessing privileged user data", async () => {
    const resolveUserId = vi.fn();
    const updatePassword = vi.fn();
    await expect(
      performAdminPasswordReset(input, {
        isAdministrator: async () => false,
        resolveUserId,
        updatePassword,
      }),
    ).rejects.toThrow("Solo un administrador");
    expect(resolveUserId).not.toHaveBeenCalled();
    expect(updatePassword).not.toHaveBeenCalled();
  });
  it.each(["staff", "client"] as const)(
    "lets administrators directly set a %s password without email",
    async (targetKind) => {
      const updatePassword = vi.fn().mockResolvedValue(true);
      const resolveUserId = vi.fn().mockResolvedValue(input.targetId);
      const result = await performAdminPasswordReset(
        { ...input, targetKind },
        {
          isAdministrator: async () => true,
          resolveUserId,
          updatePassword,
        },
      );
      expect(updatePassword).toHaveBeenCalledExactlyOnceWith(input.targetId, input.password);
      expect(result).toEqual({ ok: true });
      expect(JSON.stringify(result)).not.toContain(input.password);
    },
  );
  it("does not change passwords for unlinked profiles", async () => {
    const updatePassword = vi.fn();
    await expect(
      performAdminPasswordReset(input, {
        isAdministrator: async () => true,
        resolveUserId: async () => null,
        updatePassword,
      }),
    ).rejects.toThrow("cuenta de acceso vinculada");
    expect(updatePassword).not.toHaveBeenCalled();
  });
  it("requires valid password lengths and targets", () => {
    expect(() => validatePasswordReset({ ...input, password: "short" })).toThrow();
    expect(() => validatePasswordReset({ ...input, password: "x".repeat(73) })).toThrow();
    expect(() => validatePasswordReset({ ...input, targetId: "invalid" })).toThrow();
  });
  it("does not return the password on a failed update", async () => {
    await expect(
      performAdminPasswordReset(input, {
        isAdministrator: async () => true,
        resolveUserId: async () => input.targetId,
        updatePassword: async () => false,
      }),
    ).rejects.toThrow("No se pudo actualizar");
  });
});
