import { ipcMain, safeStorage, shell } from "electron";
import type Database from "better-sqlite3";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { IPC } from "@prospero/shared";
import { createConnectionsRepository, type Cipher } from "../connections/connections-repository.js";
import { buildAuthorizeUrl, generatePkce, exchangeCode } from "../connections/x-oauth.js";
import { getMe, type XHttp } from "../connections/x-client.js";
import { getAccount, validateStripeKeyShape } from "../connections/stripe-client.js";

// 0.2.X P1 — the "Connect X" flow lives ENTIRELY in the app (Settings). Nothing is
// hardcoded: the user pastes their own X app Client ID, authorises in the browser,
// and the OAuth tokens are stored encrypted on their machine (connections table) —
// nothing personal ever touches git.

const CALLBACK_PORT = 8723;
const REDIRECT_URI = `http://127.0.0.1:${String(CALLBACK_PORT)}/x/callback`;
const X_SCOPES = ["tweet.read", "tweet.write", "users.read", "offline.access"];
const OAUTH_TIMEOUT_MS = 5 * 60_000;

// safeStorage-backed cipher — the real encryption boundary the connections repo
// stays decoupled from (so the repo is unit-testable; this lives here with electron).
// Exported so the orchestrator's `x.post` event handler can decrypt the company's
// token in MAIN (the MCP child has no safeStorage).
export const safeStorageCipher = (): Cipher => ({
  encrypt: (plain) => safeStorage.encryptString(plain).toString("base64"),
  decrypt: (stored) => safeStorage.decryptString(Buffer.from(stored, "base64")),
});

// Adapts global fetch (Node 18+/Electron) to the connectors' injected XHttp shape.
export const httpFetch: XHttp = async (url, init) => {
  const res = await fetch(url, init);
  return { status: res.status, json: () => res.json() };
};

type ConnectResult = { connected: boolean; handle?: string; error?: string };

type StripeConnectResult = {
  connected: boolean;
  account?: string;
  livemode?: boolean;
  error?: string;
};

// Runs the OAuth 2.0 PKCE loopback flow: opens the system browser to X's authorize
// page, waits for the redirect to 127.0.0.1:8723, exchanges the code for tokens, and
// resolves the tokens + the @handle. Single-shot local server, 5-minute timeout.
const runXOAuth = async (
  clientId: string,
): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  handle: string;
  userId: string;
}> => {
  const { verifier, challenge } = generatePkce(randomBytes(32));
  const state = randomBytes(16).toString("hex");
  const authorizeUrl = buildAuthorizeUrl({
    clientId,
    redirectUri: REDIRECT_URI,
    scopes: X_SCOPES,
    state,
    codeChallenge: challenge,
  });

  const code = await new Promise<string>((resolve, reject) => {
    const timers: { h?: ReturnType<typeof setTimeout> } = {};
    const server = createServer((req, res) => {
      const reqUrl = new URL(req.url ?? "", REDIRECT_URI);
      if (reqUrl.pathname !== "/x/callback") {
        res.writeHead(404).end();
        return;
      }
      if (timers.h !== undefined) clearTimeout(timers.h);
      const gotCode = reqUrl.searchParams.get("code");
      const gotState = reqUrl.searchParams.get("state");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      if (gotCode === null || gotState !== state) {
        res.end("<h2>Falha ao conectar o X. Pode fechar esta aba.</h2>");
        server.close();
        reject(new Error("OAuth callback: missing code or state mismatch"));
        return;
      }
      res.end("<h2>X conectado! Pode fechar esta aba e voltar ao Prospero.</h2>");
      server.close();
      resolve(gotCode);
    });
    server.on("error", (e) => {
      if (timers.h !== undefined) clearTimeout(timers.h);
      reject(e);
    });
    server.listen(CALLBACK_PORT, "127.0.0.1", () => {
      void shell.openExternal(authorizeUrl);
    });
    timers.h = setTimeout(() => {
      server.close();
      reject(new Error("Conexão com o X expirou (5 min sem autorização)."));
    }, OAUTH_TIMEOUT_MS);
  });

  const tokens = await exchangeCode(
    httpFetch,
    { clientId, code, redirectUri: REDIRECT_URI, codeVerifier: verifier },
    () => Date.now(),
  );
  const me = await getMe(httpFetch, tokens.accessToken);
  return { ...tokens, handle: me.username, userId: me.id };
};

export const registerConnectionsHandlers = (db: Database.Database): void => {
  const repo = createConnectionsRepository(db, safeStorageCipher());

  ipcMain.handle(
    IPC.CONNECTIONS_X_STATUS,
    (_e, companyId: unknown): { connected: boolean; handle?: string } => {
      if (typeof companyId !== "string") return { connected: false };
      const x = repo.listMetadata(companyId).find((c) => c.kind === "x");
      if (x === undefined) return { connected: false };
      const handle = typeof x.metadata.handle === "string" ? x.metadata.handle : undefined;
      return handle !== undefined ? { connected: true, handle } : { connected: true };
    },
  );

  ipcMain.handle(
    IPC.CONNECTIONS_X_CONNECT,
    async (_e, payload: unknown): Promise<ConnectResult> => {
      const p = payload as { companyId?: unknown; clientId?: unknown };
      if (
        typeof p.companyId !== "string" ||
        typeof p.clientId !== "string" ||
        p.clientId.trim() === ""
      ) {
        return { connected: false, error: "Informe o Client ID do seu app do X." };
      }
      try {
        const r = await runXOAuth(p.clientId.trim());
        repo.save(
          p.companyId,
          "x",
          { accessToken: r.accessToken, refreshToken: r.refreshToken, expiresAt: r.expiresAt },
          { clientId: p.clientId.trim(), handle: `@${r.handle}`, userId: r.userId },
        );
        return { connected: true, handle: `@${r.handle}` };
      } catch (e) {
        return { connected: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
  );

  ipcMain.handle(IPC.CONNECTIONS_X_DISCONNECT, (_e, companyId: unknown): { connected: false } => {
    if (typeof companyId === "string") repo.clear(companyId, "x");
    return { connected: false };
  });

  ipcMain.handle(
    IPC.CONNECTIONS_STRIPE_STATUS,
    (_e, companyId: unknown): { connected: boolean; account?: string; livemode?: boolean } => {
      if (typeof companyId !== "string") return { connected: false };
      const s = repo.listMetadata(companyId).find((c) => c.kind === "stripe");
      if (s === undefined) return { connected: false };
      const account =
        typeof s.metadata.displayName === "string" ? s.metadata.displayName : undefined;
      const livemode = typeof s.metadata.livemode === "boolean" ? s.metadata.livemode : undefined;
      return {
        connected: true,
        ...(account !== undefined ? { account } : {}),
        ...(livemode !== undefined ? { livemode } : {}),
      };
    },
  );

  ipcMain.handle(
    IPC.CONNECTIONS_STRIPE_CONNECT,
    async (_e, payload: unknown): Promise<StripeConnectResult> => {
      const p = payload as { companyId?: unknown; key?: unknown };
      if (typeof p.companyId !== "string" || typeof p.key !== "string" || p.key.trim() === "") {
        return { connected: false, error: "Cole a chave restrita do seu Stripe." };
      }
      const key = p.key.trim();
      const check = validateStripeKeyShape(key);
      if (!check.ok) return { connected: false, error: check.error };
      try {
        const account = await getAccount(httpFetch, key);
        repo.save(
          p.companyId,
          "stripe",
          { restrictedKey: key },
          { accountId: account.id, displayName: account.displayName, livemode: check.livemode },
        );
        return { connected: true, account: account.displayName, livemode: check.livemode };
      } catch (e) {
        return { connected: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
  );

  ipcMain.handle(
    IPC.CONNECTIONS_STRIPE_DISCONNECT,
    (_e, companyId: unknown): { connected: false } => {
      if (typeof companyId === "string") repo.clear(companyId, "stripe");
      return { connected: false };
    },
  );
};
