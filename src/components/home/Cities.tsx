import { MapPin } from "lucide-react";
import { SectionHeading } from "../SectionHeading";

const VISIBLE_CITIES = 8;

export function Cities({ cities }: { cities: string[] }) {
  const shown = cities.slice(0, VISIBLE_CITIES);
  const rest = cities.length - shown.length;

  return (
    <section id="geografiya" className="section-compact geo-slot">
      <div className="container-page w-full">
        <div className="mx-auto max-w-2xl rounded-3xl border border-border bg-white p-6 shadow-[var(--shadow-card)] sm:p-8">
          <SectionHeading
            label="География"
            title="Точки сертификации"
            description="Работаем удалённо по всей России."
          />

          <div className="mt-6 flex flex-wrap justify-center gap-2">
            {shown.map((city) => (
              <span
                key={city}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-white px-3.5 py-1.5 text-sm font-medium whitespace-nowrap shadow-sm"
              >
                <MapPin className="h-3.5 w-3.5 text-accent" />
                {city}
              </span>
            ))}
            {rest > 0 && (
              <span className="inline-flex items-center rounded-full bg-accent-soft/90 px-3.5 py-1.5 text-sm font-medium text-primary">
                и ещё {rest} регионов
              </span>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
