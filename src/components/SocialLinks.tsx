import type { SiteConfig } from "@/lib/types";

type SocialLinksProps = {
  social: SiteConfig["social"];
  variant?: "hero" | "footer" | "contact";
  className?: string;
};

const items = [
  { key: "telegram" as const, label: "Telegram" },
  { key: "whatsapp" as const, label: "WhatsApp" },
  { key: "max" as const, label: "Макс" },
];

export function SocialLinks({
  social,
  variant = "contact",
  className = "",
}: SocialLinksProps) {
  const links = items.filter((item) => social[item.key]?.trim());

  if (links.length === 0) return null;

  if (variant === "hero") {
    return (
      <div className={`flex flex-wrap gap-2 ${className}`}>
        {links.map((item) => (
          <a
            key={item.key}
            href={social[item.key]}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-3.5 py-2 text-sm font-medium text-white backdrop-blur transition hover:bg-white/20"
          >
            <SocialIcon name={item.key} />
            <span>{item.label}</span>
          </a>
        ))}
      </div>
    );
  }

  if (variant === "footer") {
    return (
      <ul className={`flex flex-wrap gap-2 ${className}`}>
        {links.map((item) => (
          <li key={item.key}>
            <a
              href={social[item.key]}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={item.label}
              className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 p-2.5 text-blue-100 transition hover:border-white/30 hover:bg-white/10 hover:text-white sm:px-3.5 sm:py-2 sm:text-sm"
            >
              <SocialIcon name={item.key} className="h-4 w-4" />
              <span className="hidden sm:inline">{item.label}</span>
            </a>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className={`grid grid-cols-3 gap-2 ${className}`}>
      {links.map((item) => (
        <a
          key={item.key}
          href={social[item.key]}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-outline flex-col gap-1.5 px-2 py-3 text-center text-xs sm:flex-row sm:gap-2 sm:px-3 sm:py-2.5 sm:text-sm"
        >
          <SocialIcon name={item.key} className="h-5 w-5 sm:h-4 sm:w-4" />
          <span>{item.label}</span>
        </a>
      ))}
    </div>
  );
}

function SocialIcon({
  name,
  className = "h-4 w-4 shrink-0",
}: {
  name: "telegram" | "whatsapp" | "max";
  className?: string;
}) {
  if (name === "telegram") {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z" />
      </svg>
    );
  }
  if (name === "whatsapp") {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.435 9.884-9.881 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
      </svg>
    );
  }
  return <MaxIcon className={className} />;
}

function MaxIcon({ className = "h-4 w-4 shrink-0" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M24 0C37.2548 0 48 10.7452 48 24C48 37.2548 37.2548 48 24 48C10.7452 48 0 37.2548 0 24C0 10.7452 10.7452 0 24 0ZM24.2314 12.5C17.8663 12.5 12.4942 17.4255 12.4941 23.9727C12.4941 26.714 13.0015 28.6059 13.4482 30.3047C13.8233 31.6836 14.1543 32.9467 14.1543 34.4414C14.3143 36.4326 17.9823 35.2685 19.1406 33.7793C20.9718 35.1031 22.0251 35.4346 24.292 35.4346C30.5586 35.4011 35.6151 30.2999 35.5938 24.0332C35.5937 17.6682 30.602 12.5 24.2314 12.5ZM24.3857 18.1592V18.165C27.5981 18.349 30.0709 21.0719 29.9453 24.2871C29.7296 27.4955 26.9854 29.9406 23.7734 29.7861C22.768 29.7055 21.8016 29.3614 20.9717 28.7881C20.4699 29.2899 19.6648 29.9402 19.3447 29.8633C18.6774 29.6868 17.8938 26.2951 18.335 23.5098C18.87 20.1452 21.2859 17.9993 24.3857 18.1592Z"
        fill="currentColor"
      />
    </svg>
  );
}
