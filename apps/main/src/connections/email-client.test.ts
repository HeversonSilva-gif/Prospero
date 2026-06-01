import { describe, it, expect } from "vitest";
import {
  sendEmail,
  readRecentEmails,
  verifyConnection,
  EmailError,
  type EmailDeps,
  type SmtpPayload,
  type ResendPayload,
} from "./email-client.js";

const smtp: SmtpPayload = {
  mode: "smtp",
  from: "me@biz.com",
  smtpHost: "smtp.gmail.com",
  smtpPort: 465,
  smtpSecure: true,
  smtpUser: "me@biz.com",
  smtpPass: "app-pass",
  imapHost: "imap.gmail.com",
  imapPort: 993,
};
const resend: ResendPayload = { mode: "resend", from: "hi@biz.com", apiKey: "re_123" };

const deps = (over: Partial<EmailDeps>): EmailDeps => ({
  http: () => Promise.resolve({ status: 200, json: () => Promise.resolve({ id: "msg_1" }) }),
  smtpSend: () => Promise.resolve({ messageId: "smtp_1" }),
  smtpVerify: () => Promise.resolve(),
  imapFetch: () => Promise.resolve([]),
  ...over,
});

describe("sendEmail — resend", () => {
  it("POSTs to the resend API with the bearer key and returns the id", async () => {
    let captured:
      | { url: string; init: { method: string; headers: Record<string, string>; body?: string } }
      | undefined;
    const r = await sendEmail(
      deps({
        http: (url, init) => {
          captured = { url, init };
          return Promise.resolve({ status: 200, json: () => Promise.resolve({ id: "msg_9" }) });
        },
      }),
      resend,
      { to: "buyer@x.com", subject: "Seu acesso", text: "Obrigado!" },
    );
    expect(captured?.url).toBe("https://api.resend.com/emails");
    expect(captured?.init.headers.Authorization).toBe("Bearer re_123");
    const body = JSON.parse(captured?.init.body ?? "{}") as {
      from: string;
      to: string[];
      subject: string;
    };
    expect(body.from).toBe("hi@biz.com");
    expect(body.to).toEqual(["buyer@x.com"]);
    expect(r).toEqual({ messageId: "msg_9" });
  });

  it("adds threading headers when inReplyTo is set", async () => {
    let body: { headers?: Record<string, string> } | undefined;
    await sendEmail(
      deps({
        http: (_u, init) => {
          body = JSON.parse(init.body ?? "{}") as { headers?: Record<string, string> };
          return Promise.resolve({ status: 200, json: () => Promise.resolve({ id: "x" }) });
        },
      }),
      resend,
      { to: "a@b.com", subject: "re", text: "hi", inReplyTo: "<abc@x>" },
    );
    expect(body?.headers?.["In-Reply-To"]).toBe("<abc@x>");
  });

  it("throws EmailError on a resend failure", async () => {
    await expect(
      sendEmail(
        deps({
          http: () =>
            Promise.resolve({ status: 401, json: () => Promise.resolve({ message: "bad key" }) }),
        }),
        resend,
        { to: "a@b.com", subject: "s", text: "t" },
      ),
    ).rejects.toBeInstanceOf(EmailError);
  });
});

describe("sendEmail — smtp", () => {
  it("delegates to smtpSend with the recipients + threading headers", async () => {
    let got: { to: string[]; headers?: Record<string, string> } | undefined;
    const r = await sendEmail(
      deps({
        smtpSend: (_p, m) => {
          got = m;
          return Promise.resolve({ messageId: "smtp_9" });
        },
      }),
      smtp,
      { to: ["a@b.com", "c@d.com"], subject: "s", text: "t", inReplyTo: "<id@x>" },
    );
    expect(got?.to).toEqual(["a@b.com", "c@d.com"]);
    expect(got?.headers?.["In-Reply-To"]).toBe("<id@x>");
    expect(r).toEqual({ messageId: "smtp_9" });
  });
});

describe("readRecentEmails", () => {
  it("uses imapFetch in smtp mode", async () => {
    const r = await readRecentEmails(
      deps({
        imapFetch: () =>
          Promise.resolve([
            {
              from: "x@y.com",
              subject: "hi",
              snippet: "...",
              date: "2026-06-01",
              messageId: "<1>",
            },
          ]),
      }),
      smtp,
      5,
    );
    expect(r[0]?.from).toBe("x@y.com");
  });
  it("throws in resend mode (inbound unavailable)", async () => {
    await expect(readRecentEmails(deps({}), resend, 5)).rejects.toBeInstanceOf(EmailError);
  });
});

describe("verifyConnection", () => {
  it("resend: accepts a well-formed re_ key without a network call", async () => {
    let called = false;
    await verifyConnection(
      deps({
        http: () => {
          called = true;
          return Promise.resolve({ status: 200, json: () => Promise.resolve({}) });
        },
      }),
      resend,
    );
    expect(called).toBe(false);
  });
  it("resend: rejects a key that is not shaped like re_", async () => {
    await expect(
      verifyConnection(deps({}), { mode: "resend", from: "a@b.com", apiKey: "nope" }),
    ).rejects.toBeInstanceOf(EmailError);
  });
  it("smtp: calls smtpVerify", async () => {
    let called = false;
    await verifyConnection(
      deps({
        smtpVerify: () => {
          called = true;
          return Promise.resolve();
        },
      }),
      smtp,
    );
    expect(called).toBe(true);
  });
});
