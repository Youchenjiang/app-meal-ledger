import { describe, expect, test, vi } from "vitest";
import { createTemporaryScan, discardTemporaryScan, expireTemporaryScans, retainTemporaryScan } from "./media";
import { requestSignedUpload } from "./upload";

describe("media privacy and cleanup boundaries", () => {
  const now = new Date("2026-07-13T00:00:00.000Z");

  test("only unretained temporary scans become expired", () => {
    const temporary = createTemporaryScan({ intent: "scan-receipt", fileName: "receipt.jpg", mimeType: "image/jpeg", byteSize: 20 }, "scan-temporary", now);
    const retainedSource = createTemporaryScan({ intent: "scan-invoice", fileName: "invoice.jpg", mimeType: "image/jpeg", byteSize: 20 }, "scan-retained", now);
    const discardedSource = createTemporaryScan({ intent: "scan-receipt", fileName: "discard.jpg", mimeType: "image/jpeg", byteSize: 20 }, "scan-discarded", now);
    if (!temporary || !retainedSource || !discardedSource) throw new Error("Expected valid temporary scans.");
    const retained = retainTemporaryScan(retainedSource);
    const discarded = discardTemporaryScan(discardedSource);

    const expired = expireTemporaryScans([temporary, retained, discarded], new Date("2026-07-14T00:00:01.000Z"));

    expect(expired).toEqual([
      expect.objectContaining({ id: "scan-temporary", state: "expired" }),
      expect.objectContaining({ id: "scan-retained", state: "retained", expiresAt: null }),
      expect.objectContaining({ id: "scan-discarded", state: "discarded" }),
    ]);
  });

  test("propagates signed upload errors without exposing a storage URL", async () => {
    const invoke = vi.fn().mockResolvedValue({ data: null, error: { message: "unauthorized" } });

    await expect(requestSignedUpload({ functions: { invoke } }, { contentType: "image/jpeg", kind: "meal-photo" })).resolves.toEqual({
      ok: false,
      error: "unauthorized",
    });
  });

  test("rejects malformed upload responses and public-url-only responses", async () => {
    const malformed = vi.fn().mockResolvedValue({ data: { mediaId: "media-1", objectKey: "private/object" }, error: null });
    const publicUrlOnly = vi.fn().mockResolvedValue({ data: { mediaId: "media-1", objectKey: "private/object", publicUrl: "https://public.test" }, error: null });

    await expect(requestSignedUpload({ functions: { invoke: malformed } }, { contentType: "image/jpeg", kind: "receipt-scan" })).resolves.toEqual({
      ok: false,
      error: "上傳端點回傳無效回應。",
    });
    await expect(requestSignedUpload({ functions: { invoke: publicUrlOnly } }, { contentType: "image/jpeg", kind: "receipt-scan" })).resolves.toEqual({
      ok: false,
      error: "上傳端點回傳無效回應。",
    });
  });
});
