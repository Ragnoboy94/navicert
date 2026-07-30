"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { Menu, X, Phone, Mail } from "lucide-react";
import type { SiteConfig } from "@/lib/types";
import { BrandLogo } from "./BrandLogo";

const nav = [
  { href: "/uslugi", label: "Услуги" },
  { href: "/produkciya", label: "Продукция" },
  { href: "/blog", label: "Статьи" },
  { href: "/#preimuschestva", label: "Преимущества" },
  { href: "/#etapy", label: "Этапы" },
  { href: "/#otzyvy", label: "Отзывы" },
  { href: "/#faq", label: "Вопросы" },
  { href: "/#kontakty", label: "Контакты" },
];

export function Header({ site }: { site: SiteConfig }) {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1370px)");
    const onChange = () => {
      if (mq.matches) setOpen(false);
    };
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return (
    <header
      className={`sticky top-0 z-50 transition-all duration-300 ${
        scrolled
          ? "border-b border-border bg-white/95 shadow-sm backdrop-blur-md"
          : "bg-white"
      }`}
    >
      <div className="container-page flex items-center justify-between gap-4 py-3.5">
        <BrandLogo
          name={site.name}
          variant="header"
          onClick={() => setOpen(false)}
        />

        {/* Полное меню — только широкий экран, как раньше */}
        <nav className="hidden items-center gap-1 min-[1370px]:flex">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-full px-3.5 py-2 text-sm font-medium text-muted transition hover:bg-accent-soft hover:text-primary"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        {/*
          <1370: контакты + Заявка + бургер одним блоком справа (прижаты друг к другу).
          >=1370: только контакты + Заявка справа, без бургера — как раньше.
        */}
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="hidden items-center gap-3 sm:flex">
            <div className="flex flex-col items-start justify-center gap-0.5 border-r border-border pr-4 min-[1700px]:flex-row min-[1700px]:items-center min-[1700px]:gap-3">
              <a
                href={`tel:${site.phoneRaw}`}
                className="flex items-center gap-1.5 text-sm font-semibold leading-tight text-primary-dark whitespace-nowrap hover:text-primary"
              >
                <Phone className="h-4 w-4 shrink-0 text-accent" />
                {site.phone}
              </a>
              <a
                href={`mailto:${site.email}`}
                className="flex max-w-full items-center gap-1.5 text-sm leading-tight text-muted transition hover:text-primary"
              >
                <Mail className="h-4 w-4 shrink-0 text-accent" />
                <span className="truncate">{site.email}</span>
              </a>
            </div>
            <Link href="/#zayavka" className="btn-primary px-5 py-2.5 text-sm">
              Заявка
            </Link>
          </div>

          <button
            type="button"
            className="rounded-2xl p-2.5 text-foreground min-[1370px]:hidden"
            onClick={() => setOpen(!open)}
            aria-label={open ? "Закрыть меню" : "Открыть меню"}
          >
            {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </div>
      </div>

      {open && (
        <div className="border-t border-border bg-white px-4 py-5 min-[1370px]:hidden">
          <nav className="flex flex-col gap-1">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-2xl px-3 py-3 text-base font-medium text-foreground hover:bg-accent-soft"
                onClick={() => setOpen(false)}
              >
                {item.label}
              </Link>
            ))}
            <div className="mt-3 space-y-2 border-t border-border pt-3 sm:hidden">
              <a
                href={`tel:${site.phoneRaw}`}
                className="flex items-center gap-2 px-3 font-semibold text-primary"
              >
                <Phone className="h-4 w-4 text-accent" />
                {site.phone}
              </a>
              <a
                href={`mailto:${site.email}`}
                className="flex items-center gap-2 px-3 text-muted"
              >
                <Mail className="h-4 w-4 text-accent" />
                {site.email}
              </a>
            </div>
            <Link
              href="/#zayavka"
              className="btn-primary mt-3 px-4 py-3 text-center sm:hidden"
              onClick={() => setOpen(false)}
            >
              Оставить заявку
            </Link>
          </nav>
        </div>
      )}
    </header>
  );
}
