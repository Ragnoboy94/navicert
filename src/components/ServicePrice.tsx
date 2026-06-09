export function ServicePrice({
  price,
  size = "md",
  className = "",
}: {
  price: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const sizes = {
    sm: "px-2.5 py-0.5 text-xs",
    md: "px-3 py-1 text-sm",
    lg: "px-4 py-1.5 text-base",
  };

  return (
    <span
      className={`inline-flex items-center rounded-full bg-accent-soft font-bold text-primary ${sizes[size]} ${className}`}
    >
      {price}
    </span>
  );
}
