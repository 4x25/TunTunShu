import { getAuthKey } from "./env.ts";

const bearerPrefix = "Bearer ";

export function extractBearerToken(request: Request): string | null {
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith(bearerPrefix)) {
    return null;
  }
  return authorization.slice(bearerPrefix.length).trim() || null;
}

export function isAdminRequest(request: Request): boolean {
  return extractBearerToken(request) === getAuthKey();
}

export function requireAdmin(request: Request): Response | null {
  if (isAdminRequest(request)) {
    return null;
  }
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}
