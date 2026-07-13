import Link from "next/link";
import type { SiteConfig } from "@/lib/types";
import { SocialLinks } from "./SocialLinks";

const footerNav = [
  { href: "/uslugi", label: "Услуги" },
  { href: "/produkciya", label: "Продукция" },
  { href: "/blog", label: "Статьи" },
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
      <div className="container-page py-8 sm:py-10 lg:py-14">
        <div className="grid grid-cols-2 gap-x-6 gap-y-8 sm:gap-x-8 lg:grid-cols-4 lg:gap-10">
          <div className="col-span-2 lg:col-span-1">
            <p className="text-lg font-bold tracking-wide sm:text-xl">{site.name}</p>
            <p className="mt-2 hidden text-sm leading-relaxed text-blue-200 sm:mt-3 sm:block">
              {site.tagline}
            </p>
            <p className="mt-2 text-xs text-blue-300 sm:mt-4 sm:text-sm">
              {site.owner}
              <span className="mx-1.5 text-blue-500">·</span>
              ИНН {site.inn}
            </p>
            <SocialLinks
              social={site.social}
              variant="footer"
              className="mt-4 sm:mt-5"
            />
          </div>

          <div>
            <h3 className="mb-3 text-sm font-semibold sm:mb-4 sm:text-base">
              Навигация
            </h3>
            <ul className="space-y-1.5 sm:space-y-2">
              {footerNav.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="text-xs text-blue-200 transition hover:text-white sm:text-sm"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="mb-3 text-sm font-semibold sm:mb-4 sm:text-base">
              Контакты
            </h3>
            <ul className="space-y-1.5 text-xs text-blue-200 sm:space-y-2 sm:text-sm">
              <li>
                <a href={`tel:${site.phoneRaw}`} className="hover:text-white">
                  {site.phone}
                </a>
              </li>
              <li>
                <a href={`mailto:${site.email}`} className="break-all hover:text-white">
                  {site.email}
                </a>
              </li>
            </ul>
          </div>

          <div className="col-span-2 lg:col-span-1">
            <h3 className="mb-3 text-sm font-semibold sm:mb-4 sm:text-base">
              Партнёры
            </h3>
            <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-blue-300 sm:gap-y-1.5 sm:text-sm lg:grid-cols-1">
              {partners.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-8 flex flex-col items-center justify-between gap-3 border-t border-white/10 pt-6 text-xs text-blue-400 sm:mt-10 sm:flex-row sm:pt-8 sm:text-sm">
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
