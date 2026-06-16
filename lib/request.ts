export async function readJson<T>(request: Request): Promise<T | null> {
  return await request.json().catch(() => null) as T | null;
}

export function routeId(params: Record<string, string | undefined>): number {
  return Number(params.id);
}
