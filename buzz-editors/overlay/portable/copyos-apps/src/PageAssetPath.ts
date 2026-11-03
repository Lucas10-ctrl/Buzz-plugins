/** Resolve a local URL against its containing stylesheet without escaping the project. */
export function localProjectPath(
  value: string,
  baseFile: string,
): string | null {
  const clean = value.trim().split(/[?#]/u, 1)[0] ?? "";
  if (
    clean === "" ||
    /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/iu.test(clean) ||
    clean.startsWith("/api/file")
  )
    return null;
  const base = baseFile.includes("/")
    ? baseFile.slice(0, baseFile.lastIndexOf("/") + 1)
    : "";
  const normalized: string[] = [];
  for (const part of `${clean.startsWith("/") ? "" : base}${clean.replace(/^\/+/, "")}`.split(
    "/",
  )) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (normalized.length === 0) return null;
      normalized.pop();
    } else normalized.push(part);
  }
  return normalized.length === 0 ? null : normalized.join("/");
}
