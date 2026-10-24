import type { NextRequest } from "next/server";

import { json, toApiError } from "@/lib/api";
import { getTTS, isKeyConfigured, isLanguage } from "@/lib/tts";

/**
 * GET /api/tts/voices?q=&language=&scope=public&limit=24&cursor=
 * Proxies AssemblyAI's GET /v1/voices so the browser never sees the key.
 */
export async function GET(request: NextRequest) {
  if (!isKeyConfigured()) return json({ error: "ASSEMBLYAI_API_KEY is not set", code: "not_configured" }, 503);

  const sp = request.nextUrl.searchParams;
  const scope = sp.get("scope");
  const language = sp.get("language");
  const limit = Math.min(Math.max(Number(sp.get("limit") ?? 24) || 24, 1), 100);
  const q = sp.get("q")?.trim().slice(0, 64);

  try {
    const result = await getTTS().listVoices(
      {
        scope: scope === "owned" || scope === "all" ? scope : "public",
        q: q || undefined,
        language: language && isLanguage(language) ? language : undefined,
        sort: sp.get("sort") === "recent" ? "recent" : "name",
        limit,
        cursor: sp.get("cursor") ?? undefined,
      },
      request.signal,
    );
    return json(result);
  } catch (e) {
    const { status, body } = toApiError(e);
    return json(body, status);
  }
}
