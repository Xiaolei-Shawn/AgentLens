function slugifySource(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "unknown";
}

function normalizeSources(source?: string | null, sources?: string[] | null): string[] {
  const values = [
    ...(source ? [source] : []),
    ...(Array.isArray(sources) ? sources : []),
  ]
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  return [...new Set(values)];
}

function formatSourceLabel(source: string): string {
  if (source === "canonical") return "Canonical";
  if (source === "forensic") return "Forensic";
  return source.replace(/[_-]+/g, " ");
}

interface EvidenceSourcePillProps {
  source?: string | null;
  sources?: string[] | null;
  className?: string;
}

export function EvidenceSourcePill({
  source,
  sources,
  className,
}: EvidenceSourcePillProps) {
  const values = normalizeSources(source, sources);
  if (values.length === 0) return null;

  return (
    <div
      className={["trust-review__source-group", className].filter(Boolean).join(" ")}
      aria-label="Evidence source attribution"
    >
      {values.map((value) => (
        <span
          key={value}
          className={`trust-review__source-pill trust-review__source-pill--${slugifySource(value)}`}
          title={value}
        >
          {formatSourceLabel(value)}
        </span>
      ))}
    </div>
  );
}
