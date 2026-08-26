import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

import { CollectionError } from "@/lib/collectors/types";

const USER_AGENT = "AutumnRecruitmentRadar/0.1 (+local personal job-search monitor)";
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const blockedAddresses = new BlockList();

for (const [network, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
  ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blockedAddresses.addSubnet(network, prefix, "ipv4");
for (const [network, prefix] of [
  ["::", 128], ["::1", 128], ["100::", 64],
  ["2001:db8::", 32], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8],
] as const) blockedAddresses.addSubnet(network, prefix, "ipv6");

export function isBlockedAddress(address: string, family: number): boolean {
  return blockedAddresses.check(address, family === 6 ? "ipv6" : "ipv4");
}

function decodeBody(bytes: Uint8Array, contentType: string | null): string {
  const asciiHead = new TextDecoder("ascii").decode(bytes.slice(0, 2048));
  const charset =
    contentType?.match(/charset\s*=\s*["']?([^;"'\s]+)/i)?.[1] ??
    asciiHead.match(/charset\s*=\s*["']?([^;"'\s/>]+)/i)?.[1] ??
    "utf-8";
  const normalized = /^(gbk|gb2312|gb18030)$/i.test(charset) ? "gb18030" : charset;
  try {
    return new TextDecoder(normalized).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

export function assertSafePublicUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new CollectionError("链接格式无效，请粘贴完整的 http 或 https 地址。", "invalid_url", 400);
  }
  if (!/^https?:$/.test(url.protocol)) {
    throw new CollectionError("只支持公开的 http 或 https 招聘链接。", "unsupported_protocol", 400);
  }
  if (url.username || url.password) {
    throw new CollectionError("招聘链接不能包含账号或密码。", "url_credentials_not_allowed", 400);
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (hostname === "localhost" || hostname.endsWith(".local")) {
    throw new CollectionError("不能读取本机或局域网地址。", "private_url", 400);
  }
  if (isIP(hostname)) {
    const privateIpv4 = /^(?:10\.|127\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(hostname);
    const privateIpv6 = /^(?:0*:)*0*(?:1|fc|fd|fe8|fe9|fea|feb)(?::|$)/i.test(hostname);
    if (privateIpv4 || privateIpv6) {
      throw new CollectionError("不能读取本机或局域网地址。", "private_url", 400);
    }
  }
  return url;
}

async function assertPublicHostname(url: URL, allowedHosts?: readonly string[]): Promise<void> {
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (allowedHosts && !allowedHosts.some((host) => hostname === host.toLowerCase())) {
    throw new CollectionError("页面跳转到了非预期站点，已停止读取。", "unexpected_host", 422);
  }
  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = isIP(hostname)
      ? [{ address: hostname, family: isIP(hostname) }]
      : await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new CollectionError("域名当前无法解析，请检查链接后重试。", "dns_failed", 422);
  }
  if (addresses.length === 0) throw new CollectionError("域名没有可用的公开地址。", "dns_failed", 422);
  for (const record of addresses) {
    if (isBlockedAddress(record.address, record.family)) {
      throw new CollectionError("不能读取本机、局域网或保留网络地址。", "private_url", 400);
    }
  }
}

async function readLimitedBody(response: Response): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new CollectionError("页面体积超过 4 MB，未自动导入；请粘贴招聘正文。", "page_too_large", 413);
    }
    chunks.push(value);
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

export async function fetchHtml(
  value: string,
  options: { timeoutMs?: number; allowedHosts?: readonly string[] } = {},
): Promise<{ html: string; finalUrl: string; contentType: string }> {
  let url = assertSafePublicUrl(value);
  let response: Response | null = null;
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    await assertPublicHostname(url, options.allowedHosts);
    try {
      response = await fetch(url, {
        redirect: "manual",
        cache: "no-store",
        headers: {
          "user-agent": USER_AGENT,
          accept: "text/html,application/xhtml+xml;q=0.9,text/plain;q=0.7,*/*;q=0.2",
          "accept-language": "zh-CN,zh;q=0.9,en;q=0.6",
        },
        signal: AbortSignal.timeout(options.timeoutMs ?? 18_000),
      });
    } catch (error) {
      if (error instanceof CollectionError) throw error;
      const detail = error instanceof Error ? error.message : String(error);
      throw new CollectionError(`页面读取失败：${detail}`, "fetch_failed");
    }
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers.get("location");
    await response.body?.cancel();
    if (!location) throw new CollectionError("页面返回了无效跳转。", "invalid_redirect", 502);
    if (redirectCount === MAX_REDIRECTS) throw new CollectionError("页面跳转次数过多。", "too_many_redirects", 422);
    url = assertSafePublicUrl(new URL(location, url).toString());
  }
  if (!response) throw new CollectionError("页面读取失败。", "fetch_failed");
  if (!response.ok) {
    throw new CollectionError(`页面返回 HTTP ${response.status}，暂时无法读取。`, "http_error", response.status);
  }
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_RESPONSE_BYTES) {
    throw new CollectionError("页面体积超过 4 MB，未自动导入；请粘贴招聘正文。", "page_too_large", 413);
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType && !/(?:text\/(?:html|plain)|application\/xhtml\+xml)/i.test(contentType)) {
    throw new CollectionError("链接返回的不是可解析网页，请粘贴招聘正文。", "unsupported_content_type", 415);
  }
  const bytes = await readLimitedBody(response);
  return { html: decodeBody(bytes, contentType), finalUrl: url.toString(), contentType };
}

/**
 * Read JSON from a fixed public API endpoint. Collector callers must pin the
 * expected host so a future configuration change cannot turn this into an
 * unrestricted server-side request primitive.
 */
export async function postJson(
  value: string,
  body: unknown,
  options: { timeoutMs?: number; allowedHosts: readonly string[] },
): Promise<unknown> {
  const url = assertSafePublicUrl(value);
  await assertPublicHostname(url, options.allowedHosts);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      redirect: "error",
      cache: "no-store",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        "accept-language": "zh-CN,zh;q=0.9,en;q=0.6",
        "user-agent": USER_AGENT,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(options.timeoutMs ?? 18_000),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new CollectionError(`接口读取失败：${detail}`, "fetch_failed");
  }

  if (!response.ok) {
    await response.body?.cancel();
    throw new CollectionError(`接口返回 HTTP ${response.status}，暂时无法读取。`, "http_error", response.status);
  }
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_RESPONSE_BYTES) {
    await response.body?.cancel();
    throw new CollectionError("接口响应体积超过 4 MB，已停止读取。", "page_too_large", 413);
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType && !/(?:application|text)\/json/i.test(contentType)) {
    await response.body?.cancel();
    throw new CollectionError("接口返回的不是 JSON 数据。", "unsupported_content_type", 415);
  }
  const bytes = await readLimitedBody(response);
  try {
    return JSON.parse(decodeBody(bytes, contentType)) as unknown;
  } catch {
    throw new CollectionError("接口返回了无法解析的 JSON 数据。", "invalid_json");
  }
}

/** Read JSON from a fixed public endpoint that expects HTML form encoding. */
export async function postFormJson(
  value: string,
  body: Record<string, string | number | boolean>,
  options: {
    timeoutMs?: number;
    allowedHosts: readonly string[];
    referer?: string;
  },
): Promise<unknown> {
  const url = assertSafePublicUrl(value);
  await assertPublicHostname(url, options.allowedHosts);

  const form = new URLSearchParams();
  for (const [key, item] of Object.entries(body)) form.set(key, String(item));

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      redirect: "error",
      cache: "no-store",
      headers: {
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        accept: "application/json, text/javascript, */*; q=0.01",
        "accept-language": "zh-CN,zh;q=0.9,en;q=0.6",
        "user-agent": USER_AGENT,
        "x-requested-with": "XMLHttpRequest",
        ...(options.referer ? { referer: options.referer } : {}),
      },
      body: form.toString(),
      signal: AbortSignal.timeout(options.timeoutMs ?? 18_000),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new CollectionError(`接口读取失败：${detail}`, "fetch_failed");
  }

  if (!response.ok) {
    await response.body?.cancel();
    throw new CollectionError(`接口返回 HTTP ${response.status}，暂时无法读取。`, "http_error", response.status);
  }
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_RESPONSE_BYTES) {
    await response.body?.cancel();
    throw new CollectionError("接口响应体积超过 4 MB，已停止读取。", "page_too_large", 413);
  }
  const contentType = response.headers.get("content-type") ?? "";
  const bytes = await readLimitedBody(response);
  try {
    return JSON.parse(decodeBody(bytes, contentType)) as unknown;
  } catch {
    throw new CollectionError("接口返回了无法解析的 JSON 数据。", "invalid_json");
  }
}
