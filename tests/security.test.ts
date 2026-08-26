import { describe, expect, it } from "vitest";

import { assertSafePublicUrl, fetchHtml, isBlockedAddress } from "@/lib/collectors/http";
import { isTrustedLocalMutation } from "@/lib/request-security";

describe("手动链接安全边界", () => {
  it("只接受 http(s)，并拒绝字面量本机与局域网地址", async () => {
    expect(() => assertSafePublicUrl("file:///C:/Windows/win.ini")).toThrow(/http|https/);
    expect(() => assertSafePublicUrl("http://localhost:3000/private")).toThrow(/本机|局域网/);
    expect(() => assertSafePublicUrl("http://192.168.1.5/job")).toThrow(/本机|局域网/);
    await expect(fetchHtml("http://0.0.0.0/internal")).rejects.toMatchObject({ code: "private_url" });
  });

  it("允许公网 IPv4，同时拦截 IPv4 及其 IPv6 映射形式的私网地址", () => {
    expect(isBlockedAddress("104.16.4.14", 4)).toBe(false);
    expect(isBlockedAddress("::ffff:104.16.4.14", 6)).toBe(false);
    expect(isBlockedAddress("127.0.0.1", 4)).toBe(true);
    expect(isBlockedAddress("::ffff:127.0.0.1", 6)).toBe(true);
  });

  it("拒绝浏览器从其他网站触发本地写操作", () => {
    const local = new Request("http://127.0.0.1:3000/api/refresh", {
      method: "POST",
      headers: { origin: "http://127.0.0.1:3000", "sec-fetch-site": "same-origin" },
    });
    const crossSite = new Request("http://127.0.0.1:3000/api/refresh", {
      method: "POST",
      headers: { origin: "https://malicious.example", "sec-fetch-site": "cross-site" },
    });
    expect(isTrustedLocalMutation(local)).toBe(true);
    const loopbackAlias = new Request("http://localhost:3000/api/refresh", {
      method: "POST",
      headers: { origin: "http://127.0.0.1:3000", "sec-fetch-site": "same-site" },
    });
    expect(isTrustedLocalMutation(loopbackAlias)).toBe(true);
    expect(isTrustedLocalMutation(crossSite)).toBe(false);
  });
});
