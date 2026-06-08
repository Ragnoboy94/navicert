import Link from "next/link";
import type { SiteConfig } from "@/lib/types";

const footerNav = [
  { href: "/uslugi", label: "Услуги" },
  { href: "/produkciya", label: "Продукция" },
  { href: "/#preimuschestva", label: "Преимущества" },
  { href: "/#etapy", label: "Этапы" },
  { href: "/#otzyvy", label: "Отзывы" },
  { href: "/#faq", label: "Вопросы" },
  { href: "/#kontakty", label: "Контакты" },
];

export function Footer({
  site,
  partners,
}: {
  site: SiteConfig;
  partners: string[];
}) {
  const year = new Date().getFullYear();

  return (
    <footer className="bg-primary-dark text-white">
      <div className="container-page py-12 lg:py-14">
        <div className="grid gap-10 md:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="text-xl font-bold tracking-wide">{site.name}</p>
            <p className="mt-3 text-sm leading-relaxed text-blue-200">
              {site.tagline}
            </p>
            <p className="mt-4 text-sm text-blue-300">
              {site.owner}
              <br />
              ИНН {site.inn}
            </p>
          </div>

          <div>
            <h3 className="mb-4 font-semibold">Навигация</h3>
            <ul className="space-y-2">
              {footerNav.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="text-sm text-blue-200 transition hover:text-white"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="mb-4 font-semibold">Контакты</h3>
            <ul className="space-y-2 text-sm text-blue-200">
              <li>
                <a href={`tel:${site.phoneRaw}`} className="hover:text-white">
                  {site.phone}
                </a>
              </li>
              <li>
                <a href={`mailto:${site.email}`} className="hover:text-white">
                  {site.email}
                </a>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="mb-4 font-semibold">Партнёры</h3>
            <ul className="space-y-1.5 text-sm text-blue-300">
              {partners.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-10 flex flex-col items-center justify-between gap-3 border-t border-white/10 pt-8 text-sm text-blue-400 sm:flex-row">
          <p>
            © {site.copyright} {year}
          </p>
          <Link href="/privacy" className="hover:text-white">
            Политика конфиденциальности
          </Link>
        </div>
      </div>
    </footer>
  );
}
