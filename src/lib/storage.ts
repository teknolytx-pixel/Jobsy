import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { env } from "./env";

/**
 * RESUME-001 — private file storage.
 *
 * Two backends behind one interface:
 *
 *   • Vercel Blob when BLOB_READ_WRITE_TOKEN is set (production).
 *   • The local filesystem otherwise, so the app runs and is fully testable
 *     with no third-party account — the same principle the email module uses.
 *
 * The invariants that matter are the same in both:
 *
 *   AC-6 — nothing is publicly readable. Files are reached only through a
 *          signed URL this module issues, never a bucket path.
 *   AC-8 — signed URLs expire in 15 minutes.
 *   AC-9 — the signature binds the resume id AND the viewer, so a URL leaked
 *          from one recruiter's screen does not work for anyone else.
 */

const TTL_SEC = 15 * 60;
const LOCAL_ROOT = process.env.RESUME_STORAGE_DIR ?? "/tmp/jobsy-resumes";

const blobToken = () => process.env.BLOB_READ_WRITE_TOKEN;
export const usingBlob = () => Boolean(blobToken());

export function storageKeyFor(userId: string, filename: string): string {
  // A random component means a key cannot be guessed from a user id, so even a
  // misconfigured bucket does not enumerate.
  const ext = path.extname(filename).toLowerCase().slice(0, 8) || ".bin";
  return `resumes/${userId}/${randomBytes(16).toString("hex")}${ext}`;
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  const token = blobToken();
  if (token) {
    const res = await fetch(`https://blob.vercel-storage.com/${encodeURI(key)}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": contentType,
        // Private, always. A resume in a public bucket is a breach waiting for
        // someone to guess a URL.
        "x-content-type": contentType,
        "x-add-random-suffix": "0",
        "x-access": "private",
      },
      body: new Uint8Array(body),
    });
    if (!res.ok) throw new Error(`Blob upload failed (${res.status}): ${await res.text()}`);
    return;
  }

  const full = path.join(LOCAL_ROOT, key);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, body, { mode: 0o600 });
}

export async function getObject(key: string): Promise<Buffer | null> {
  const token = blobToken();
  if (token) {
    const res = await fetch(`https://blob.vercel-storage.com/${encodeURI(key)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  }
  try {
    return await fs.readFile(path.join(LOCAL_ROOT, key));
  } catch {
    return null;
  }
}

export async function deleteObject(key: string): Promise<void> {
  const token = blobToken();
  if (token) {
    await fetch(`https://blob.vercel-storage.com/delete`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ urls: [key] }),
    }).catch(() => undefined);
    return;
  }
  await fs.rm(path.join(LOCAL_ROOT, key), { force: true }).catch(() => undefined);
}

// ─────────────────────────────────────────────────────────────
// Signed URLs
// ─────────────────────────────────────────────────────────────

const signingKey = () => env.authSecret;

/**
 * Sign a download grant.
 *
 * `viewerId` is part of the signed payload deliberately (AC-9). Without it a
 * URL is a bearer token for the document, and bearer tokens end up in Slack.
 */
export function signResumeUrl(resumeId: string, viewerId: string, ttlSec = TTL_SEC): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const payload = `${resumeId}.${viewerId}.${exp}`;
  const sig = createHmac("sha256", signingKey()).update(payload).digest("base64url");
  return `${env.appUrl}/api/resumes/${resumeId}/file?v=${encodeURIComponent(viewerId)}&e=${exp}&s=${sig}`;
}

export type SigCheck = { ok: true } | { ok: false; reason: "EXPIRED" | "BAD_SIGNATURE" };

export function verifyResumeSignature(
  resumeId: string,
  viewerId: string,
  exp: string | null,
  sig: string | null
): SigCheck {
  if (!exp || !sig) return { ok: false, reason: "BAD_SIGNATURE" };
  const expNum = Number(exp);
  if (!Number.isFinite(expNum)) return { ok: false, reason: "BAD_SIGNATURE" };

  const expected = createHmac("sha256", signingKey())
    .update(`${resumeId}.${viewerId}.${expNum}`)
    .digest("base64url");

  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  // Compare before checking expiry, and in constant time, so neither the
  // validity nor the length of a signature is learnable from timing.
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "BAD_SIGNATURE" };
  }
  if (expNum * 1000 < Date.now()) return { ok: false, reason: "EXPIRED" };
  return { ok: true };
}

export const SIGNED_URL_TTL_SEC = TTL_SEC;
