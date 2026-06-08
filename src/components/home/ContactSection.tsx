import { Phone, Mail } from "lucide-react";
import type { QuizConfig, SiteConfig } from "@/lib/types";
import { SectionHeading } from "../SectionHeading";
import { ContactForm } from "../ContactForm";
import { QuizTeaser } from "./QuizTeaser";

export function ContactSection({
  site,
  quiz,
}: {
  site: SiteConfig;
  quiz: QuizConfig;
}) {
  return (
    <section id="kontakty" className="section surface-blue text-white">
      <div className="container-page">
        <SectionHeading
          center
          light
          label="Контакты"
          title="Бесплатная консультация"
          description="Определим необходимые документы и рассчитаем стоимость без обязательств."
        />

        <div className="mx-auto mt-8 grid max-w-5xl gap-6 lg:grid-cols-5">
          <div className="space-y-4 lg:col-span-2">
            <a
              href={`tel:${site.phoneRaw}`}
              className="flex items-center gap-4 rounded-2xl border border-white/15 bg-white/10 p-4 backdrop-blur transition hover:bg-white/15"
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent/20">
                <Phone className="h-5 w-5 text-accent" />
              </div>
              <div>
                <p className="text-sm text-blue-200">Телефон</p>
                <p className="font-semibold whitespace-nowrap">{site.phone}</p>
              </div>
            </a>
            <a
              href={`mailto:${site.email}`}
              className="flex items-center gap-4 rounded-2xl border border-white/15 bg-white/10 p-4 backdrop-blur transition hover:bg-white/15"
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent/20">
                <Mail className="h-5 w-5 text-accent" />
              </div>
              <div className="min-w-0">
                <p className="text-sm text-blue-200">E-mail</p>
                <p className="truncate font-semibold">{site.email}</p>
              </div>
            </a>
            <QuizTeaser config={quiz} />
            <div className="flex gap-2">
              <a
                href={site.social.telegram}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-outline flex-1 px-4 py-2.5 text-sm"
              >
                Telegram
              </a>
              <a
                href={site.social.whatsapp}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-outline flex-1 px-4 py-2.5 text-sm"
              >
                WhatsApp
              </a>
            </div>
          </div>

          <div id="zayavka" className="card lg:col-span-3 lg:p-8 p-6 text-foreground">
            <ContactForm source="homepage" />
          </div>
        </div>
      </div>
    </section>
  );
}
