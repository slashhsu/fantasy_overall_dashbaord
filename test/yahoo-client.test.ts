import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchYahooXml, resetYahooTokenForTests, YahooApiError } from "@/lib/yahoo-client";

describe("Yahoo OAuth client", () => {
  beforeEach(() => {
    process.env.YAHOO_CLIENT_ID = "client";
    process.env.YAHOO_CLIENT_SECRET = "secret";
    process.env.YAHOO_REFRESH_TOKEN = "refresh";
    process.env.YAHOO_REDIRECT_URI = "https://example.com";
    resetYahooTokenForTests();
  });

  afterEach(() => vi.restoreAllMocks());

  it("refreshes a token and keeps credentials out of the Fantasy request", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "access", expires_in: 3600 }), { status: 200 }))
      .mockResolvedValueOnce(new Response("<fantasy_content />", { status: 200 }));

    await expect(fetchYahooXml("/users;use_login=1/games")).resolves.toBe("<fantasy_content />");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][1]?.headers && (fetchMock.mock.calls[1][1]?.headers as Record<string, string>).Authorization)).toBe("Bearer access");
    expect(JSON.stringify(fetchMock.mock.calls[1])).not.toContain("secret");
  });

  it("surfaces Yahoo failures without treating them as successful data", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "access" }), { status: 200 }))
      .mockImplementation(async () => new Response("rate limited", { status: 429 }));
    await expect(fetchYahooXml("/league/test/settings")).rejects.toBeInstanceOf(YahooApiError);
  });
});
