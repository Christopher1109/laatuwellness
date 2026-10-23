import { useState } from "react";
import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ScheduleHourEntry({ times, pending, onAdd }: {
  times: string[];
  pending: boolean;
  onAdd: (time: string) => void;
}) {
  const [selected, setSelected] = useState("");
  const last = times.at(-1) ?? "06:00";
  const time = selected || last;
  const shift = (minutes: number) => {
    const [hours = 0, mins = 0] = time.split(":").map(Number);
    const total = (hours * 60 + mins + minutes + 1440) % 1440;
    setSelected(`${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`);
  };
  return (
    <form className="mt-4 flex flex-wrap items-end gap-3" onSubmit={(event) => {
      event.preventDefault();
      if (!pending && !times.includes(time)) onAdd(time);
    }}>
      <label className="text-xs">
        <span className="eyebrow">Agregar hora nueva</span>
        <input aria-label="Agregar hora nueva" type="time" step={60} value={time}
          onChange={(event) => setSelected(event.target.value)}
          className="block h-10 w-32 border border-input bg-transparent px-3 text-sm outline-none focus:border-foreground" />
      </label>
      <div className="flex h-10 items-center gap-1">
        <Button type="button" variant="outline" size="icon" aria-label="Restar 5 minutos" title="Restar 5 minutos" disabled={pending} onClick={() => shift(-5)}><Minus /></Button>
        <Button type="button" variant="outline" size="icon" aria-label="Sumar 5 minutos" title="Sumar 5 minutos" disabled={pending} onClick={() => shift(5)}><Plus /></Button>
      </div>
      <div className="flex flex-wrap gap-2">
        {[30, 50, 55, 60].map((minutes) => <Button key={minutes} type="button" variant="outline" className="h-10 rounded-none" disabled={pending} onClick={() => shift(minutes)}>+{minutes} min</Button>)}
      </div>
      <Button type="submit" className="h-10 rounded-none" disabled={pending || times.includes(time)}><Plus />{pending ? "Guardando…" : "Agregar hora"}</Button>
    </form>
  );
}