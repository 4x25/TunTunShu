export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function ok(data: unknown = { success: true }): Response {
  return json(data);
}

export function notImplemented(): Response {
  return json({ error: "Not implemented" }, 501);
}
