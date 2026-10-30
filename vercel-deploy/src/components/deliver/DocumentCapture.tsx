"use client";

import { useRef, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export type UploadedDocument = { path: string; name: string };

const MAX_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];

type Props = {
  userId: string;
  docType: string;
  label: string;
  hint?: string;
  required: boolean;
  status?: string;
  reviewerNote?: string | null;
  /** `environment` for documents, `user` for a self photograph. */
  facing?: "environment" | "user";
  allowPdf?: boolean;
  value: UploadedDocument | null;
  onChange: (value: UploadedDocument | null) => void;
  onError: (message: string) => void;
};

/**
 * One private document slot.
 *
 * The file goes straight into the private `provider-documents` bucket under the signed-in user's own
 * folder — the same prefix the database policy requires — and only the storage path is kept in form
 * state, so a draft can be resumed without re-uploading. Two inputs are offered: a camera capture for
 * phones and a plain picker for a desktop or an existing photograph. Neither is trusted: the server
 * re-checks the file type, the folder prefix and whether the document is required before it accepts
 * the application.
 */
export function DocumentCapture({
  userId,
  docType,
  label,
  hint,
  required,
  status,
  reviewerNote,
  facing = "environment",
  allowPdf = true,
  value,
  onChange,
  onError,
}: Props) {
  const [busy, setBusy] = useState(false);
  const cameraRef = useRef<HTMLInputElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const accepted = allowPdf ? [...IMAGE_TYPES, "application/pdf"] : IMAGE_TYPES;

  async function upload(file: File) {
    setBusy(true);
    onError("");
    try {
      if (!accepted.includes(file.type)) {
        throw new Error(
          `${file.name}: use a JPEG, PNG or WebP photograph${allowPdf ? " or a PDF" : ""}.`,
        );
      }
      if (file.size > MAX_BYTES) {
        throw new Error(`${file.name} is larger than 5 MB.`);
      }

      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 80);
      const path = `delivery/${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`;
      const db = createSupabaseBrowserClient();
      const { error } = await db.storage
        .from("provider-documents")
        .upload(path, file, { contentType: file.type, upsert: false });
      if (error) throw new Error(`Could not upload ${file.name}. ${error.message}`);

      onChange({ path, name: file.name });
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "The document could not be uploaded.");
    } finally {
      setBusy(false);
      if (cameraRef.current) cameraRef.current.value = "";
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const tone =
    status === "approved"
      ? "border-emerald-500/40 bg-emerald-500/10"
      : status === "rejected"
        ? "border-red-500/40 bg-red-500/10"
        : "border-white/10";

  return (
    <div className={`rounded-xl border p-3 ${tone}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-bold text-ink-100">
            {label}
            {required ? <span className="ml-1 text-red-300">*</span> : <span className="ml-2 text-xs font-normal text-ink-400">optional</span>}
          </p>
          {hint && <p className="mt-1 text-xs leading-5 text-ink-400">{hint}</p>}
        </div>
        {status && status !== "missing" && (
          <span className="rounded-full border border-white/15 px-2 py-0.5 text-xs font-bold text-ink-200">
            {status}
          </span>
        )}
      </div>

      {status === "rejected" && reviewerNote && (
        <p className="mt-2 rounded-lg bg-red-500/10 p-2 text-xs leading-5 text-red-100">
          Reviewer note: {reviewerNote}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture={facing}
          className="sr-only"
          onChange={event => {
            const file = event.target.files?.[0];
            if (file) void upload(file);
          }}
        />
        <input
          ref={fileRef}
          type="file"
          accept={accepted.join(",")}
          className="sr-only"
          onChange={event => {
            const file = event.target.files?.[0];
            if (file) void upload(file);
          }}
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => cameraRef.current?.click()}
          className="btn btn-secondary text-xs"
        >
          {busy ? "Uploading…" : "Take photo"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
          className="btn btn-secondary text-xs"
        >
          Choose file
        </button>
        {value && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onChange(null)}
            className="text-xs font-bold text-ink-300 underline"
          >
            Remove
          </button>
        )}
      </div>

      {value ? (
        <p className="mt-2 break-all text-xs text-emerald-200">
          Selected: {value.name}
        </p>
      ) : (
        <p className="mt-2 text-xs text-ink-500">
          {status === "missing" || !status
            ? "No file selected yet."
            : "Nothing new selected; the file already on record stays as it is."}
        </p>
      )}
      <p className="mt-1 text-[11px] leading-4 text-ink-500">
        Private bucket · JPEG, PNG or WebP{allowPdf ? " or PDF" : ""} · up to 5 MB · file{" "}
        {docType.replaceAll("_", " ")}
      </p>
    </div>
  );
}
