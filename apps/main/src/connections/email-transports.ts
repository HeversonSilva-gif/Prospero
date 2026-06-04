import nodemailer from "nodemailer";
import { ImapFlow } from "imapflow";
import {
  extractBodySnippet,
  extractReferencesHeader,
  type SmtpPayload,
  type SmtpMessage,
  type InboundEmail,
  type SmtpSendFn,
  type SmtpVerifyFn,
  type ImapFetchFn,
} from "./email-client.js";

// Electron-side production transports for the email connector. Not unit-tested (they do
// real network I/O) — mirrors derivation's defaultRunProcess / the wrangler runner. The
// pure logic + the Resend HTTP path carry the test coverage in email-client.test.ts.

const transporter = (p: SmtpPayload): nodemailer.Transporter =>
  nodemailer.createTransport({
    host: p.smtpHost,
    port: p.smtpPort,
    secure: p.smtpSecure,
    auth: { user: p.smtpUser, pass: p.smtpPass },
  });

export const defaultSmtpSend: SmtpSendFn = async (p, m: SmtpMessage) => {
  // nodemailer's SentMessageInfo is loosely typed; assert the one field we read.
  const info = (await transporter(p).sendMail({
    from: p.from,
    to: m.to,
    subject: m.subject,
    text: m.text,
    ...(m.html !== undefined ? { html: m.html } : {}),
    ...(m.headers !== undefined ? { headers: m.headers } : {}),
  })) as { messageId: string };
  return { messageId: info.messageId };
};

export const defaultSmtpVerify: SmtpVerifyFn = async (p) => {
  await transporter(p).verify();
};

// Max bytes of body we download per message to scan for injection (C2). Bounded so a
// huge HTML payload / inline attachment can't be loaded wholesale into memory.
const BODY_FETCH_BYTES = 4096;

// Pulls a bounded text slice of the message body so the injection guard can actually scan
// it (C2). The prior `snippet: ""` meant the guard only ever saw subject — the real
// prompt-injection vector (the body) was never scanned. Fail-soft: any body-fetch error
// falls back to "" so the poll never throws and at least the envelope is still returned.
const fetchBodySnippet = async (client: ImapFlow, seq: number): Promise<string> => {
  try {
    // part "1" = the first body part (the text). maxBytes caps the streamed download so a
    // large body/attachment is never pulled wholesale.
    const dl = await client.download(String(seq), "1", {
      uid: false,
      maxBytes: BODY_FETCH_BYTES,
    });
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of dl.content) {
      const buf = chunk as Buffer;
      chunks.push(buf);
      total += buf.length;
      if (total >= BODY_FETCH_BYTES) break;
    }
    return extractBodySnippet(Buffer.concat(chunks).toString("utf8"), BODY_FETCH_BYTES);
  } catch {
    // Body unavailable / no such part / partial download failed — degrade to envelope-only.
    return "";
  }
};

export const defaultImapFetch: ImapFetchFn = async (p, limit) => {
  const client = new ImapFlow({
    host: p.imapHost,
    port: p.imapPort,
    // Implicit TLS for every port EXCEPT the plaintext STARTTLS port 143 (imapflow then
    // upgrades). Any non-143 port (993, or a custom TLS port) gets implicit TLS — never
    // fall back to cleartext for a non-standard port (M6).
    secure: p.imapPort !== 143,
    auth: { user: p.smtpUser, pass: p.smtpPass },
    logger: false,
  });
  const out: InboundEmail[] = [];
  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const mailbox = client.mailbox;
      const total = typeof mailbox === "object" ? mailbox.exists : 0;
      if (total > 0) {
        const start = Math.max(1, total - limit + 1);
        const seqs: number[] = [];
        // Pull the References header alongside the envelope (one fetch) so a reply can
        // accumulate the thread chain instead of resetting it after one hop (M6).
        for await (const msg of client.fetch(`${String(start)}:*`, {
          envelope: true,
          headers: ["references"],
        })) {
          const env = msg.envelope;
          seqs.push(msg.seq);
          out.push({
            from: env?.from?.[0]?.address ?? "",
            subject: env?.subject ?? "",
            // Filled below from a BOUNDED body download so the injection guard scans it (C2).
            snippet: "",
            date: env?.date?.toISOString() ?? "",
            messageId: env?.messageId ?? "",
            references: extractReferencesHeader(
              msg.headers !== undefined ? msg.headers.toString("utf8") : "",
            ),
          });
        }
        // Download bodies AFTER the envelope iterator drains (imapflow forbids a second
        // command mid-fetch). Each is bounded + fail-soft (envelope-only on error).
        for (let i = 0; i < out.length; i += 1) {
          const seq = seqs[i];
          if (seq !== undefined) {
            const entry = out[i];
            if (entry !== undefined) entry.snippet = await fetchBodySnippet(client, seq);
          }
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }
  return out.reverse();
};
