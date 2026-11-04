import { useState } from "react";
import { CalendarDays } from "lucide-react";
import { es } from "react-day-picker/locale";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";

/**
 * Selector de fecha del estudio. Reemplaza al <input type="date"> nativo
 * porque el calendario del navegador decide solo el primer día de la semana
 * (Chrome en español lo pone en lunes). Aquí la semana siempre empieza en
 * domingo. Trabaja con "AAAA-MM-DD" igual que el input nativo y, si lleva
 * `name`, manda el valor en formularios con un input oculto.
 */

const pad = (n: number) => String(n).padStart(2, "0");
const toYmd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function fromYmd(value: string | null | undefined): Date | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? "");
  if (!m) return undefined;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? undefined : d;
}
const display = (d: Date) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;

export function DateInput({
  value,
  defaultValue,
  onChange,
  name,
  id,
  min,
  max,
  required,
  className,
  placeholder = "dd/mm/aaaa",
  clearable = true,
  yearPicker = false,
  "aria-label": ariaLabel,
}: {
  value?: string;
  defaultValue?: string | null;
  onChange?: (value: string) => void;
  name?: string;
  id?: string;
  min?: string;
  max?: string;
  required?: boolean;
  className?: string;
  placeholder?: string;
  clearable?: boolean;
  /** Para fechas lejanas (cumpleaños): agrega selectores de mes y año. */
  yearPicker?: boolean;
  "aria-label"?: string;
}) {
  const [inner, setInner] = useState(defaultValue ?? "");
  const [open, setOpen] = useState(false);
  const current = value !== undefined ? value : inner;
  const selected = fromYmd(current);
  const minDate = fromYmd(min);
  const maxDate = fromYmd(max);

  const set = (v: string) => {
    if (value === undefined) setInner(v);
    onChange?.(v);
  };

  // Mes que se abre si no hay fecha: hoy, o el límite más cercano si hoy queda fuera.
  const today = new Date();
  const startView =
    minDate && today < minDate ? minDate : maxDate && today > maxDate ? maxDate : today;

  const disabled = [
    ...(minDate ? [{ before: minDate }] : []),
    ...(maxDate ? [{ after: maxDate }] : []),
  ];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          id={id}
          aria-label={ariaLabel}
          className={cn(
            "flex items-center justify-between gap-2 text-left",
            !selected && "text-muted-foreground",
            className,
          )}
        >
          <span>{selected ? display(selected) : placeholder}</span>
          <CalendarDays className="h-4 w-4 shrink-0 opacity-70" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          locale={es}
          weekStartsOn={0}
          captionLayout={yearPicker ? "dropdown" : "label"}
          {...(selected ? { selected } : {})}
          defaultMonth={selected ?? startView}
          {...(disabled.length ? { disabled } : {})}
          {...(yearPicker
            ? { startMonth: minDate ?? new Date(1900, 0, 1), endMonth: maxDate ?? new Date() }
            : {})}
          onSelect={(d) => {
            if (!d) return;
            set(toYmd(d));
            setOpen(false);
          }}
        />
        <div className="flex justify-between border-t border-border px-3 py-2 text-xs">
          {clearable && !required ? (
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => {
                set("");
                setOpen(false);
              }}
            >
              Borrar
            </button>
          ) : (
            <span />
          )}
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => {
              if ((minDate && today < minDate) || (maxDate && today > maxDate)) return;
              set(toYmd(today));
              setOpen(false);
            }}
          >
            Hoy
          </button>
        </div>
      </PopoverContent>
      {name ? <input type="hidden" name={name} value={current} /> : null}
      {required ? (
        <input
          tabIndex={-1}
          aria-hidden
          required
          value={current}
          onChange={() => undefined}
          className="pointer-events-none absolute h-0 w-0 opacity-0"
        />
      ) : null}
    </Popover>
  );
}
