// Correos de aviso de fin de membresía (10 días antes). Funciones puras para
// poder probarlas; el envío lo hace /api/public/reminders/run con Resend.

export type ReminderRow = {
  user_id: string;
  email: string;
  full_name: string | null;
  plan_name: string;
  ends_at: string;
  is_founders: boolean;
  auto_renew_plan: string | null;
  /** Membresía (familia) del aviso; una clienta puede tener varias. */
  family_id?: string | null;
};

export type ReminderEmail = {
  template: "founders" | "generica" | "renovacion_automatica";
  subject: string;
  html: string;
  text: string;
};

export const ACCOUNT_URL = "https://laatuwellness.com/cuenta";

const INK = "#1f1d1a";
const IVORY = "#f6f2ea";

export function formatEndDate(iso: string): string {
  return new Intl.DateTimeFormat("es-MX", {
    day: "numeric",
    month: "long",
    timeZone: "America/Monterrey",
  }).format(new Date(iso));
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function firstName(fullName: string | null): string {
  const first = (fullName ?? "").trim().split(/\s+/)[0] ?? "";
  if (!first) return "";
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

type Block =
  | { kind: "p"; text: string }
  | { kind: "option"; title: string; text: string }
  | { kind: "important"; title: string; items: string[] };

function render(blocks: Block[], header: string, cta: string): { html: string; text: string } {
  const htmlBlocks = blocks
    .map((b) => {
      if (b.kind === "p") {
        return `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;">${escapeHtml(b.text)}</p>`;
      }
      if (b.kind === "option") {
        return `<div style="margin:0 0 16px;padding:14px 16px;border:1px solid #d9d2c5;">
<p style="margin:0 0 6px;font-size:14px;font-weight:bold;letter-spacing:.04em;">${escapeHtml(b.title)}</p>
<p style="margin:0;font-size:14px;line-height:1.55;">${escapeHtml(b.text)}</p></div>`;
      }
      return `<div style="margin:8px 0 20px;padding:16px;background:${INK};color:${IVORY};">
<p style="margin:0 0 10px;font-size:15px;font-weight:bold;letter-spacing:.06em;">${escapeHtml(b.title)}</p>
<ul style="margin:0;padding-left:18px;font-size:14px;line-height:1.6;">${b.items
        .map((i) => `<li>${escapeHtml(i)}</li>`)
        .join("")}</ul></div>`;
    })
    .join("\n");

  const html = `<!DOCTYPE html><html lang="es"><body style="margin:0;padding:0;background:${IVORY};">
<div style="max-width:560px;margin:0 auto;padding:32px 24px;font-family:Georgia,'Times New Roman',serif;color:${INK};">
<p style="margin:0 0 24px;font-size:12px;letter-spacing:.2em;">${escapeHtml(header)}</p>
${htmlBlocks}
<p style="margin:24px 0;text-align:center;"><a href="${ACCOUNT_URL}" style="display:inline-block;padding:14px 28px;background:${INK};color:${IVORY};text-decoration:none;font-size:12px;letter-spacing:.18em;text-transform:uppercase;">${escapeHtml(cta)}</a></p>
<p style="margin:32px 0 0;font-size:12px;letter-spacing:.2em;">LAATU WELLNESS</p>
<p style="margin:4px 0 0;font-size:13px;font-style:italic;">Move your way.</p>
</div></body></html>`;

  const text = [
    header,
    "",
    ...blocks.flatMap((b) => {
      if (b.kind === "p") return [b.text, ""];
      if (b.kind === "option") return [b.title, b.text, ""];
      return [b.title, ...b.items.map((i) => `• ${i}`), ""];
    }),
    `${cta}: ${ACCOUNT_URL}`,
    "",
    "LAATU WELLNESS",
    "Move your way.",
  ].join("\n");

  return { html, text };
}

const POLICY: Block = {
  kind: "important",
  title: "⭐ IMPORTANTE | Política de cancelación ⭐",
  items: [
    "Puedes cancelar sin costo hasta 12 horas antes de tu clase.",
    "Cancelar con menos de 12 horas o no asistir cuenta como falta.",
    "A la 3ª falta se cobra una multa de $150. Después vuelves a tener 2 faltas sin cargo, y a la siguiente se cobra de nuevo.",
    "Para continuar con tu membresía es necesario registrar una tarjeta en tu cuenta.",
  ],
};

export function buildReminderEmail(row: ReminderRow): ReminderEmail {
  const name = firstName(row.full_name);
  const hello = name ? `¡Hola, ${name}! ✨` : "¡Hola! ✨";
  const end = formatEndDate(row.ends_at);

  if (row.auto_renew_plan) {
    const { html, text } = render(
      [
        { kind: "p", text: hello },
        {
          kind: "p",
          text: `Te recordamos que tu membresía ${row.plan_name} termina el ${end} y se renovará automáticamente con tu tarjeta registrada (${row.auto_renew_plan}). No tienes que hacer nada para seguir disfrutando de tus clases.`,
        },
        {
          kind: "p",
          text: "Si quieres cambiar tu tarjeta o desactivar la renovación, puedes hacerlo desde tu cuenta.",
        },
        { kind: "p", text: "Gracias por seguir formando parte de nuestra comunidad. 🩵" },
      ],
      "LAATU WELLNESS 🩵",
      "Ir a mi cuenta",
    );
    return {
      template: "renovacion_automatica",
      subject: `Tu membresía se renueva el ${end} 🩵`,
      html,
      text,
    };
  }

  if (row.is_founders) {
    const { html, text } = render(
      [
        { kind: "p", text: hello },
        {
          kind: "p",
          text: `Queremos recordarte que tu Founders Access termina el ${end}. Si deseas continuar disfrutando de tu membresía, con acceso a 1 clase diaria, tenemos las siguientes opciones:`,
        },
        {
          kind: "option",
          title: "01 | Membresía recurrente — $4,299/mes",
          text: "Conserva tu precio especial de Founders mediante un cargo automático mensual, que se realizará el día 2 de cada mes.",
        },
        {
          kind: "option",
          title: "02 | Pago anticipado de 6 meses — $24,000",
          text: "Equivalente a $4,000 mensuales, con el beneficio adicional de poder congelar tu membresía hasta 2 semanas al año.",
        },
        {
          kind: "option",
          title: "03 | Membresía mensual sin recurrencia — $4,700/mes",
          text: "Si prefieres no activar cargos automáticos, puedes adquirir tu membresía mes a mes, mediante cualquier forma de pago, a precio regular.",
        },
        POLICY,
        {
          kind: "p",
          text: "Puedes renovar fácilmente desde tu cuenta en laatuwellness.com, en Mi cuenta › Renovar.",
        },
        {
          kind: "p",
          text: "Nos encantará que sigas formando parte de nuestra comunidad y acompañándonos en este espacio que estamos construyendo juntos. 🩵",
        },
      ],
      "LAATU WELLNESS | FOUNDERS ACCESS 🩵",
      "Renovar mi membresía",
    );
    return {
      template: "founders",
      subject: "Tu Founders Access está por terminar 🩵",
      html,
      text,
    };
  }

  const { html, text } = render(
    [
      { kind: "p", text: hello },
      {
        kind: "p",
        text: `Queremos recordarte que tu membresía ${row.plan_name} termina el ${end}.`,
      },
      {
        kind: "p",
        text: "Si deseas seguir disfrutando de tus clases y de todos los beneficios de tu membresía, puedes renovarla fácilmente desde tu cuenta.",
      },
      {
        kind: "p",
        text: "Nos encantará que sigas formando parte de nuestra comunidad y acompañándonos en este espacio que estamos construyendo juntos. 🩵",
      },
    ],
    "LAATU WELLNESS 🩵",
    "Renovar mi membresía",
  );
  return {
    template: "generica",
    subject: "Tu membresía está por terminar 🩵",
    html,
    text,
  };
}
