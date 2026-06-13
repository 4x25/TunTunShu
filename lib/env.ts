function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

export function getAuthKey(): string {
  return requiredEnv("AUTH_KEY");
}

export function getDatabaseDsn(): string {
  return requiredEnv("DATABASE_DSN");
}

export function getHost(): string {
  return Deno.env.get("HOST") || "0.0.0.0";
}

export function getPort(): number {
  return Number(Deno.env.get("PORT") || "4025");
}

export function getTimezone(): string {
  return Deno.env.get("TZ") || "Asia/Shanghai";
}
