"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { X, ZoomIn } from "lucide-react";

type Props = {
  src: string;
  alt: string;
};

export function ServiceImageLightbox({ src, alt }: Props) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);

    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group relative block w-full cursor-zoom-in overflow-hidden rounded-4xl shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        aria-label="Открыть изображение"
      >
        <Image
          src={src}
          alt={alt}
          width={280}
          height={200}
          className="h-48 w-full object-cover lg:h-44"
        />
        <span
          className="pointer-events-none absolute inset-0 flex items-center justify-center bg-primary-dark/0 transition-colors group-hover:bg-primary-dark/30 group-focus-visible:bg-primary-dark/30 [@media(hover:none)]:bg-primary-dark/20"
          aria-hidden
        >
          <ZoomIn className="h-8 w-8 text-white opacity-0 drop-shadow-md transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 [@media(hover:none)]:opacity-90" />
        </span>
      </button>

      {mounted &&
        open &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label={alt}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-8"
            onClick={close}
          >
            <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
            <button
              type="button"
              onClick={close}
              className="absolute right-3 top-3 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white sm:right-5 sm:top-5"
              aria-label="Закрыть"
            >
              <X className="h-6 w-6" />
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              alt={alt}
              className="relative z-10 max-h-[85vh] w-auto max-w-[min(100%,56rem)] rounded-lg object-contain shadow-2xl"
              onClick={(event) => event.stopPropagation()}
            />
          </div>,
          document.body
        )}
    </>
  );
}
