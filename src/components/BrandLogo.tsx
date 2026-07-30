import Image from "next/image";
import Link from "next/link";

const LOGO_MARK = "/images/logo-shield.png";
const LOGO_WORDMARK = "/images/logo-name.png";
const LOGO_TAGLINE = "Сертификация с уверенностью";

type BrandLogoProps = {
  href?: string;
  onClick?: () => void;
  variant?: "header" | "footer";
  className?: string;
  name: string;
};

export function BrandLogo({
  href = "/",
  onClick,
  variant = "header",
  className = "",
  name,
}: BrandLogoProps) {
  const mark =
    variant === "header" ? (
      <span className="inline-flex items-center gap-2 sm:gap-2.5">
        <Image
          src={LOGO_MARK}
          alt=""
          width={40}
          height={40}
          className="h-8 w-8 shrink-0 object-contain sm:h-9 sm:w-9"
          priority
          sizes="36px"
        />
        <span className="flex flex-col items-center justify-center gap-0.5 leading-none sm:gap-1">
          <Image
            src={LOGO_WORDMARK}
            alt={name}
            width={870}
            height={106}
            className="h-[1.05rem] w-auto object-contain sm:h-[1.25rem]"
            priority
            sizes="160px"
          />
          <span className="whitespace-nowrap text-[7px] font-medium uppercase tracking-[0.06em] text-[#3c3f44] sm:text-[8px] sm:tracking-[0.08em]">
            — {LOGO_TAGLINE} —
          </span>
        </span>
      </span>
    ) : (
      <span className="inline-flex items-center gap-3">
        <Image
          src={LOGO_MARK}
          alt=""
          width={40}
          height={40}
          className="h-10 w-10 object-contain"
          sizes="40px"
        />
        <span className="text-lg font-bold tracking-wide sm:text-xl">{name}</span>
      </span>
    );

  return (
    <Link
      href={href}
      onClick={onClick}
      className={`inline-flex shrink-0 items-center ${className}`}
      aria-label={`${name}. ${LOGO_TAGLINE}`}
    >
      {mark}
    </Link>
  );
}
