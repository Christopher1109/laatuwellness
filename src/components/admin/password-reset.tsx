import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { KeyRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/hooks/useAuth";
import { resetUserPassword } from "@/utils/admin-password.functions";

export function PasswordResetControl({ targetId, targetKind, name, email }: {
  targetId: string;
  targetKind: "staff" | "client";
  name: string;
  email: string;
}) {
  const { isAdmin } = useAuth();
  const reset = useServerFn(resetUserPassword);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const changeOpen = (next: boolean) => {
    if (busy) return;
    setOpen(next);
    setPassword("");
    setConfirmation("");
  };
  if (!isAdmin) return null;

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <Button type="button" variant="outline" size="sm" onClick={() => changeOpen(true)}>
        <KeyRound /> Restablecer contraseña
      </Button>
      <DialogContent className="max-w-[calc(100%-2rem)] sm:max-w-lg" onInteractOutside={(event) => { if (busy) event.preventDefault(); }} onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }}>
        <DialogHeader>
          <DialogTitle>Restablecer contraseña</DialogTitle>
          <DialogDescription className="break-words">{name} · {email}</DialogDescription>
        </DialogHeader>
        <form className="grid gap-5" onSubmit={async (event) => {
          event.preventDefault();
          if (password !== confirmation) {
            toast.error("Las contraseñas no coinciden.");
            return;
          }
          setBusy(true);
          try {
            await reset({ data: { targetId, targetKind, password } });
            setPassword("");
            setConfirmation("");
            setOpen(false);
            toast.success("Contraseña actualizada. Ya puede entrar con la nueva contraseña.");
          } catch (error) {
            toast.error(error instanceof Error ? error.message : "No se pudo actualizar la contraseña.");
          } finally {
            setBusy(false);
          }
        }}>
          <label className="grid gap-2 text-sm">
            Nueva contraseña
            <input type="password" autoComplete="new-password" required minLength={8} maxLength={72} value={password} onChange={(event) => setPassword(event.target.value)} disabled={busy} className="w-full border border-input bg-transparent px-3 py-2 outline-none focus:border-foreground" />
          </label>
          <label className="grid gap-2 text-sm">
            Confirmar contraseña
            <input type="password" autoComplete="new-password" required minLength={8} maxLength={72} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} disabled={busy} className="w-full border border-input bg-transparent px-3 py-2 outline-none focus:border-foreground" />
          </label>
          <p className="text-xs text-muted-foreground">Mínimo 8 caracteres. Se reemplazará la contraseña anterior sin enviar correo.</p>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" disabled={busy} onClick={() => changeOpen(false)}>Cancelar</Button>
            <Button type="submit" disabled={busy || password.length < 8 || !confirmation}>{busy ? "Guardando…" : "Guardar contraseña"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}