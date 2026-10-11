import { t } from "../i18n";

export const MAX_MEDIA_FILES = 20;
export const MAX_MEDIA_BYTES = 100 * 1024 * 1024;

export type UploadFileLike = {
  name: string;
  type: string;
  size: number;
};

export type UploadMediaKind = "meal-photo" | "receipt-scan" | "invoice-scan" | "attachment";

export type UploadQueueItem = UploadFileLike & {
  id: string;
  status: "queued" | "local-only" | "uploaded" | "failed";
  bytesStatus?: "available" | "metadata-only";
  kind?: UploadMediaKind;
  metadataStatus?: "local-only" | "synced";
  remoteMediaId?: string;
  bucket?: string;
  objectKey?: string;
  error?: string;
};

export type UploadBatchValidation = {
  ok: boolean;
  totalBytes: number;
  error?: string;
};

export function validateMediaBatch(files: readonly UploadFileLike[]): UploadBatchValidation {
  const totalBytes = files.reduce((total, file) => total + file.size, 0);
  if (files.length > MAX_MEDIA_FILES) {
    return { ok: false, totalBytes, error: t("upload.maxFiles", { max: MAX_MEDIA_FILES }) };
  }

  if (totalBytes > MAX_MEDIA_BYTES) {
    return { ok: false, totalBytes, error: t("upload.batchTooLarge") };
  }

  return { ok: true, totalBytes };
}

export function queueUploadFiles(files: readonly UploadFileLike[], prefix: string, kind?: UploadMediaKind): UploadQueueItem[] {
  return files.map((file, index) => ({
    ...file,
    id: `${prefix}-${index}-${file.name}`,
    status: "queued",
    bytesStatus: "available",
    ...(kind ? { kind } : {}),
  }));
}

export type SignedUploadClient = {
  functions: {
    invoke: (name: string, options: { body: Record<string, unknown> }) => Promise<{ data: unknown; error: { message: string } | null }>;
  };
};

export type SignedUploadResult = {
  mediaId: string;
  putUrl: string;
  objectKey: string;
  bucket?: string;
  expiresInSeconds: number;
};

export async function uploadMediaFile(
  client: SignedUploadClient,
  file: File,
  item: UploadQueueItem,
  capturedAt?: string,
): Promise<UploadQueueItem> {
  const kind = item.kind ?? "attachment";
  let signed: Awaited<ReturnType<typeof requestSignedUpload>>;
  try {
    signed = await requestSignedUpload(client, {
      contentType: file.type || item.type,
      kind,
      capturedAt,
    });
  } catch (error: unknown) {
    return {
      ...item,
      status: "failed",
      error: error instanceof Error ? error.message : t("upload.endpointUnreachable"),
    };
  }
  if (!signed.ok) {
    return { ...item, status: "failed", error: signed.error };
  }

  try {
    const response = await fetch(signed.value.putUrl, {
      method: "PUT",
      headers: { "Content-Type": file.type || item.type || "application/octet-stream" },
      body: file,
    });
    if (!response.ok) {
      return { ...item, status: "failed", error: t("upload.httpFailed", { status: response.status }) };
    }
    return {
      ...item,
      status: "uploaded",
      bytesStatus: "available",
      error: undefined,
      remoteMediaId: signed.value.mediaId,
      bucket: signed.value.bucket,
      objectKey: signed.value.objectKey,
      metadataStatus: "local-only",
    };
  } catch (error: unknown) {
    return {
      ...item,
      status: "failed",
      error: error instanceof Error ? error.message : t("upload.mediaFailed"),
    };
  }
}

export async function requestSignedUpload(
  client: SignedUploadClient,
  input: { contentType: string; kind: "meal-photo" | "receipt-scan" | "invoice-scan" | "attachment"; capturedAt?: string },
): Promise<{ ok: true; value: SignedUploadResult } | { ok: false; error: string }> {
  const { data, error } = await client.functions.invoke("create-r2-upload-url", {
    body: { contentType: input.contentType, kind: input.kind, capturedAt: input.capturedAt ?? null },
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  if (!data || typeof data !== "object" || !("mediaId" in data) || !("putUrl" in data) || !("objectKey" in data) || !("expiresInSeconds" in data)) {
    return { ok: false, error: t("upload.invalidResponse") };
  }

  return { ok: true, value: data as SignedUploadResult };
}
