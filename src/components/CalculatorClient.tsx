"use client";

import { useState } from "react";
import Image from "next/image";
import { DocumentQuiz } from "@/components/DocumentQuiz";
import { ContactForm } from "@/components/ContactForm";
import { SocialLinks } from "@/components/SocialLinks";
import { ArticleBodyContent } from "@/components/ArticleBodyContent";
import type { QuizConfig, QuizResult, SiteConfig } from "@/lib/types";
import { Phone, Mail } from "lucide-react";

type Props = {
  quiz: QuizConfig;
  phone: string;
  phoneRaw: string;
  email: string;
  social: SiteConfig["social"];
};

export function CalculatorClient({
  quiz,
  phone,
  phoneRaw,
  email,
  social,
}: Props) {
  const [picked, setPicked] = useState<QuizResult | null>(null);

  const howTitle = quiz.howItWorks?.title?.trim() || "Как это работает";
  const howBody =
    quiz.howItWorks?.body?.trim() ||
    "<ol><li><p>Выберите тип продукции и задачу</p></li><li><p>Получите рекомендуемый документ</p></li><li><p>Оставьте контакты — перезвоним с расчётом</p></li></ol>";

  return (
    <>
      <section className="relative overflow-hidden surface-blue text-white">
        <div
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            background:
              "radial-gradient(ellipse 80% 60% at 70% 0%, rgba(0,184,240,0.35), transparent 55%), radial-gradient(ellipse 50% 40% at 10% 80%, rgba(30,111,217,0.45), transparent 50%)",
          }}
        />
        <div className="container-page relative py-12 sm:py-16 lg:py-20">
          <h1 className="max-w-3xl text-3xl font-bold leading-tight sm:text-4xl lg:text-5xl">
            Калькулятор документов для сертификации
          </h1>
          <p className="mt-4 max-w-2xl text-base text-blue-100 sm:text-lg">
            Ответьте на вопросы — подскажем, какой документ нужен, и рассчитаем
            оформление без обязательств.
          </p>

          <div className="mt-8 grid gap-6 lg:grid-cols-5 lg:gap-8">
            <div className="lg:col-span-3">
              <DocumentQuiz
                config={quiz}
                variant="page"
                consultHref="#zayavka-calc"
                onResult={setPicked}
              />
            </div>
            <aside className="space-y-4 lg:col-span-2">
              {howBody ? (
                <div className="rounded-[1.5rem] border border-white/20 bg-white/10 p-5 backdrop-blur">
                  <p className="text-sm font-semibold text-white">{howTitle}</p>
                  <ArticleBodyContent
                    text={howBody}
                    className="calc-how-body mt-3 text-sm text-blue-100"
                  />
                </div>
              ) : null}
              <a
                href={`tel:${phoneRaw}`}
                className="flex items-center gap-3 rounded-[1.5rem] border border-white/20 bg-white/10 p-4 backdrop-blur transition hover:bg-white/15"
              >
                <Phone className="h-5 w-5 shrink-0 text-accent" />
                <div>
                  <p className="text-xs text-blue-200">Позвонить</p>
                  <p className="font-semibold">{phone}</p>
                </div>
              </a>
              <a
                href={`mailto:${email}`}
                className="flex items-center gap-3 rounded-[1.5rem] border border-white/20 bg-white/10 p-4 backdrop-blur transition hover:bg-white/15"
              >
                <Mail className="h-5 w-5 shrink-0 text-accent" />
                <div className="min-w-0">
                  <p className="text-xs text-blue-200">Написать</p>
                  <p className="truncate font-semibold">{email}</p>
                </div>
              </a>
              <SocialLinks
                social={social}
                variant="hero"
                className="w-full flex-nowrap [&>a]:min-w-0 [&>a]:flex-1 [&>a]:justify-center"
              />
            </aside>
          </div>
        </div>
      </section>

      <section id="zayavka-calc" className="section scroll-mt-24">
        <div className="container-page">
          <div className="mx-auto max-w-5xl">
            <h2 className="text-2xl font-bold text-primary-dark sm:text-3xl">
              Получить расчёт
            </h2>
            <p className="mt-2 max-w-2xl text-muted">
              Оставьте имя и телефон — эксперт свяжется и уточнит стоимость.
            </p>

            <div className="relative mt-6 lg:pr-[220px]">
              <div className="card p-6 sm:p-8 lg:p-10">
                <ContactForm
                  source="kalkulyator"
                  hideEmail
                  defaultEmail={email}
                  quizResult={picked}
                />
              </div>

              <figure className="pointer-events-none mx-auto mt-2 max-w-[200px] select-none sm:max-w-[220px] lg:absolute lg:bottom-0 lg:right-0 lg:mt-0 lg:max-w-[240px]">
                <Image
                  src="/images/calculator-invite.webp"
                  alt="Специалист Нависерт готова помочь с подбором документа"
                  width={408}
                  height={612}
                  className="h-auto w-full drop-shadow-md"
                  sizes="240px"
                />
              </figure>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
