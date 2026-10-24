# Storage buckets and private files

**Status:** migration `0024_storage_buckets_and_policies.sql` is written and applies cleanly, but it
has **not run against hosted Supabase storage**. The local database test uses PGlite, which has no
`storage` schema, so the migration deliberately no-ops there and only its syntax is exercised.

## Buckets

| Bucket | Visibility | Max size | Allowed types | Used for |
|---|---|---|---|---|
| `listing-images` | Public read | 5 MiB | `image/jpeg`, `image/png`, `image/webp` | Product and property cover photos |
| `provider-documents` | Private | 10 MiB | `image/jpeg`, `image/png`, `image/webp`, `application/pdf` | Ownership evidence, licences, verification documents |

Both are created with `insert into storage.buckets ... on conflict (id) do nothing`, so re-running the
migration is safe and never removes objects.

## Path convention

The first path segment is always the uploader's user id. Every policy in `0024` relies on it.

```text
listing-images/<user-id>/<listing-id>/cover.webp
provider-documents/<user-id>/<listing-id>/ownership-proof.pdf
```

`storage.foldername(name))[1] = auth.uid()::text` is the ownership test. A client cannot write into
another user's folder even if it knows the path.

## Access model

| Operation | `listing-images` | `provider-documents` |
|---|---|---|
| Read | anyone (public bucket) | uploader, owner (aal2), or staff with `properties.verify` |
| Upload | authenticated, own folder only | authenticated, own folder only |
| Delete | uploader, or owner | uploader, or owner |
| Overwrite | no update policy — new object per upload | no update policy |

`property_verification_documents.storage_path` stores the object path; the row itself is readable only
by the uploader, the listing owner, the owner or `properties.verify` staff (policy in migration 0021).
Storage and the metadata table are protected independently.

## Signed URLs

Private objects must be read through short-lived signed URLs generated on the server after the same
authorization check as the metadata row. Do not expose a service-role client to the browser, and do
not make `provider-documents` public to "fix" an image that will not load.

## Retention and backups

- Verification documents are personal data. Define a retention period (for example, delete rejected
  applications after 90 days) and a deletion procedure before collecting real documents.
- Supabase storage is backed up separately from the database. Confirm the plan's backup coverage for
  storage, and test restoring an object into a staging bucket.
- Do not copy verification documents into logs, tickets or email. Reference the object path only.

## Hosted verification still required

1. Apply migration `0024` to a staging project.
2. Upload as two different users and confirm each can read only their own folder.
3. Confirm an anonymous request cannot list or read `provider-documents`.
4. Confirm `listing-images` is readable and that upload is refused outside the owner's folder.
5. Confirm a >5 MiB image and a disallowed MIME type are rejected by the bucket limits.
6. Confirm owner and `properties.verify` staff access works only at aal2.

Record the results in `docs/TESTING.md`. Until then, treat hosted storage as unverified.
