export function SectionHeading({
  label,
  title,
  description,
  center = true,
  light = false,
}: {
  label?: string;
  title: string;
  description?: string;
  center?: boolean;
  light?: boolean;
}) {
  return (
    <div className={center ? "mx-auto max-w-2xl text-center" : "max-w-2xl"}>
      {label && (
        <p
          className={`mb-2 text-xs font-bold uppercase tracking-[0.2em] ${
            light ? "text-accent" : "text-accent"
          }`}
        >
          {label}
        </p>
      )}
      <h2
        className={`text-2xl font-bold tracking-tight sm:text-3xl lg:text-4xl ${
          light ? "text-white" : "text-foreground"
        }`}
      >
        {title}
      </h2>
      {description && (
        <p
          className={`mt-3 text-base leading-relaxed sm:text-lg ${
            light ? "text-blue-100" : "text-muted"
          }`}
        >
          {description}
        </p>
      )}
    </div>
  );
}
