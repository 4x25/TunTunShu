import { isIP } from "node:net";

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
]);

function ipv4Number(address: string): number | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value >>> 0;
}

function ipv4InCidr(address: number, base: number, bits: number): boolean {
  const shift = 32 - bits;
  return (address >>> shift) === (base >>> shift);
}

function isPrivateIpv4(address: string): boolean {
  const value = ipv4Number(address);
  if (value == null) return true;
  return [
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10],
    ["127.0.0.0", 8],
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.0.0.0", 24],
    ["192.0.2.0", 24],
    ["192.88.99.0", 24],
    ["192.168.0.0", 16],
    ["198.18.0.0", 15],
    ["198.51.100.0", 24],
    ["203.0.113.0", 24],
    ["224.0.0.0", 4],
    ["240.0.0.0", 4],
  ].some(([base, bits]) =>
    ipv4InCidr(value, ipv4Number(base as string)!, bits as number)
  );
}

/** 浏览器出网必须拒绝的非公网地址。 */
export function isPrivateNetworkAddress(address: string): boolean {
  const normalized = address.trim().toLowerCase().replace(/^\[|\]$/g, "");
  const kind = isIP(normalized);
  if (kind === 4) return isPrivateIpv4(normalized);
  if (kind !== 6) return true;

  const embeddedV4 = normalized.match(/(?:^|:)(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (embeddedV4) return isPrivateIpv4(embeddedV4);
  const mappedHex = normalized.match(
    /^(?:::|0:0:0:0:0:)(?:ffff:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/,
  );
  if (mappedHex) {
    const high = Number.parseInt(mappedHex[1], 16);
    const low = Number.parseInt(mappedHex[2], 16);
    return isPrivateIpv4(
      `${high >>> 8}.${high & 0xff}.${low >>> 8}.${low & 0xff}`,
    );
  }

  if (normalized === "::" || normalized === "::1") return true;
  if (/^(?:fc|fd)/.test(normalized)) return true;
  if (/^fe[89ab]/.test(normalized)) return true;
  if (/^ff/.test(normalized)) return true;
  if (/^2001:db8(?:[:]|$)/.test(normalized)) return true;
  if (/^2001:0(?:[:]|$)/.test(normalized)) return true;
  return false;
}

export function assertSafeBrowserOrigin(rawOrigin: string): string {
  let url: URL;
  try {
    url = new URL(rawOrigin.trim());
  } catch {
    throw new Error("站点 Origin 不是有效 URL");
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("站点 Origin 必须是无路径、查询或凭据的 HTTP(S) 地址");
  }
  assertSafeBrowserHostname(url.hostname);
  return url.origin;
}

export function assertSafeBrowserHostname(hostname: string): void {
  const normalized = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (
    !normalized ||
    BLOCKED_HOSTNAMES.has(normalized) ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".internal") ||
    (isIP(normalized) !== 0 && isPrivateNetworkAddress(normalized))
  ) {
    throw new Error("站点地址不是可访问的公网主机");
  }
}

/** 解析 A/AAAA 并返回已验证地址，供 Chromium 固定 DNS 结果。 */
export async function resolvePublicBrowserHostname(
  hostname: string,
): Promise<string[]> {
  assertSafeBrowserHostname(hostname);
  const normalized = hostname.replace(/^\[|\]$/g, "");
  if (isIP(normalized) !== 0) return [normalized];

  const [v4, v6] = await Promise.all([
    Deno.resolveDns(hostname, "A").catch(() => [] as string[]),
    Deno.resolveDns(hostname, "AAAA").catch(() => [] as string[]),
  ]);
  const addresses = [...v4, ...v6];
  if (addresses.length === 0) throw new Error("站点域名无法解析");
  if (addresses.some(isPrivateNetworkAddress)) {
    throw new Error("站点域名解析到了非公网地址");
  }
  return addresses;
}

/** 解析 A/AAAA 后再次检查，避免把浏览器导航到内网或云元数据地址。 */
export async function assertPublicBrowserHostname(
  hostname: string,
): Promise<void> {
  await resolvePublicBrowserHostname(hostname);
}

export async function assertPublicBrowserOrigin(
  rawOrigin: string,
): Promise<string> {
  const origin = assertSafeBrowserOrigin(rawOrigin);
  await assertPublicBrowserHostname(new URL(origin).hostname);
  return origin;
}

export async function resolvePublicBrowserOrigin(
  rawOrigin: string,
): Promise<{ origin: string; hostname: string; addresses: string[] }> {
  const origin = assertSafeBrowserOrigin(rawOrigin);
  const hostname = new URL(origin).hostname.replace(/^\[|\]$/g, "");
  const addresses = await resolvePublicBrowserHostname(hostname);
  return { origin, hostname, addresses };
}
