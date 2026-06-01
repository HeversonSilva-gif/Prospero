import { describe, it, expect } from "vitest";
import { handleEmailSendEvent, handleEmailReadEvent } from "./email-event.js";
import type { ConnectionsRepository } from "./connections-repository.js";
import type { EmailDeps } from "./email-client.js";

const smtpConn = { mode: "smtp", from: "me@biz.com", smtpUser: "me@biz.com" };

const repoWith = (payload: Record<string, unknown> | null): ConnectionsRepository => ({
  save: () => undefined,
  load: () => (payload === null ? null : { payload, metadata: {} }),
  listMetadata: () => [],
  clear: () => undefined,
});

const emailDeps = (over: Partial<EmailDeps>): EmailDeps => ({
  http: () => Promise.resolve({ status: 200, json: () => Promise.resolve({ id: "x" }) }),
  smtpSend: () => Promise.resolve({ messageId: "smtp_1" }),
  smtpVerify: () => Promise.resolve(),
  imapFetch: () => Promise.resolve([]),
  ...over,
});

describe("handleEmailSendEvent", () => {
  it("sends and writes an ok result with the message id", async () => {
    let result: unknown;
    await handleEmailSendEvent(
      {
        repo: repoWith(smtpConn),
        emailDeps: emailDeps({ smtpSend: () => Promise.resolve({ messageId: "m_9" }) }),
        writeResult: (_id, r) => {
          result = r;
        },
      },
      "c1",
      { requestId: "r1", to: "buyer@x.com", subject: "s", body: "b" },
    );
    expect(result).toEqual({ ok: true, messageId: "m_9" });
  });

  it("never throws — writes ok:false when email is not connected", async () => {
    let result: { ok: boolean } | undefined;
    await handleEmailSendEvent(
      {
        repo: repoWith(null),
        emailDeps: emailDeps({}),
        writeResult: (_id, r) => {
          result = r;
        },
      },
      "c1",
      { requestId: "r1", to: "a@b.com", subject: "s", body: "b" },
    );
    expect(result?.ok).toBe(false);
  });
});

describe("handleEmailReadEvent", () => {
  it("reads inbound and writes the list", async () => {
    let result: { ok: boolean; emails?: unknown[] } | undefined;
    await handleEmailReadEvent(
      {
        repo: repoWith(smtpConn),
        emailDeps: emailDeps({
          imapFetch: () =>
            Promise.resolve([
              { from: "x@y.com", subject: "hi", snippet: "", date: "", messageId: "<1>" },
            ]),
        }),
        writeResult: (_id, r) => {
          result = r;
        },
      },
      "c1",
      { requestId: "r1", limit: 5 },
    );
    expect(result?.ok).toBe(true);
    expect(result?.emails).toHaveLength(1);
  });
});
