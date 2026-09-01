import { resolve } from "node:path";

export function parseCloakBrowserLicenseKey(
  source: string,
): string | undefined {
  for (const rawLine of source.split(/\r?\n/)) {
    const match = rawLine.match(
      /^\s*(?:export\s+)?CLOAKBROWSER_LICENSE_KEY\s*=\s*(.*)$/,
    );
    if (!match) continue;
    let value = match[1].trim();
    if (value.startsWith('"') || value.startsWith("'")) {
      const end = value.indexOf(value[0], 1);
      value = end > 0 ? value.slice(1, end) : "";
    } else {
      value = value.replace(/\s+#.*$/, "").trim();
    }
    return value || undefined;
  }
  return undefined;
}

let cachedLicenseKey: Promise<string | undefined> | undefined;

/** Platform env wins; local development may fall back to the gitignored .env. */
export function resolveCloakBrowserLicenseKey(): Promise<string | undefined> {
  cachedLicenseKey ??= (async () => {
    const existing = Deno.env.get("CLOAKBROWSER_LICENSE_KEY")?.trim();
    if (existing) return existing;
    try {
      const source = await Deno.readTextFile(resolve(Deno.cwd(), ".env"));
      const value = parseCloakBrowserLicenseKey(source);
      if (value) Deno.env.set("CLOAKBROWSER_LICENSE_KEY", value);
      return value;
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return undefined;
      throw error;
    }
  })();
  return cachedLicenseKey;
}
