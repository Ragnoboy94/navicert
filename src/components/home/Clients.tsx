import Image from "next/image";
import type { ClientLogo } from "@/lib/types";

export function Clients({ clients }: { clients: ClientLogo[] }) {
  return (
    <section id="klienty" className="section-compact surface-white border-y border-border/60">
      <div className="container-page">
        <p className="mb-4 text-center text-xs font-bold uppercase tracking-[0.2em] text-muted">
          Нам доверяют
        </p>
        <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-4">
          {clients.map((client) => (
            <Image
              key={client.logo}
              src={client.logo}
              alt={client.name}
              width={100}
              height={40}
              className="h-8 w-auto max-w-[88px] object-contain opacity-80 grayscale transition hover:opacity-100 hover:grayscale-0 sm:h-9 sm:max-w-[100px]"
              loading="lazy"
            />
          ))}
        </div>
      </div>
    </section>
  );
}
