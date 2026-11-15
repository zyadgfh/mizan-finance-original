import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { betterAuth } from "better-auth";
import { bearer, genericOAuth } from "better-auth/plugins";
import {
  CompiledQuery,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type DatabaseConnection,
  type Dialect,
  type Driver,
  type Kysely,
  type QueryResult,
  type TransactionSettings,
} from "kysely";
import { GROK_PROVIDERS } from "./providers.ts";
import { PREVIEW_ALLOWED_HOSTS, PREVIEW_CLIENT_ID, PREVIEW_CLIENT_SECRET } from "./preview.ts";

class PgliteConn implements DatabaseConnection {
  private readonly client: PGlite;
  constructor(client: PGlite) {
    this.client = client;
  }
  async executeQuery<O>(compiledQuery: CompiledQuery): Promise<QueryResult<O>> {
    const result = await this.client.query(compiledQuery.sql, [...compiledQuery.parameters]);
    if (result.affectedRows) {
      return {
        numAffectedRows: BigInt(result.affectedRows),
        rows: result.rows as O[],
      };
    }
    return { rows: result.rows as O[] };
  }
  async *streamQuery<O>(compiledQuery: CompiledQuery): AsyncIterableIterator<QueryResult<O>> {
    const res = await this.executeQuery<O>(compiledQuery);
    yield res;
  }
}

class PgliteTestDriver implements Driver {
  private readonly client: PGlite;
  private conn: PgliteConn | undefined;
  constructor(client: PGlite) {
    this.client = client;
  }
  async init(): Promise<void> {}
  async acquireConnection(): Promise<DatabaseConnection> {
    if (!this.conn) this.conn = new PgliteConn(this.client);
    return this.conn;
  }
  async releaseConnection(): Promise<void> {}
  async beginTransaction(conn: DatabaseConnection, settings: TransactionSettings): Promise<void> {
    if (settings.isolationLevel) {
      await conn.executeQuery(CompiledQuery.raw(`start transaction isolation level ${settings.isolationLevel}`));
    } else {
      await conn.executeQuery(CompiledQuery.raw("begin"));
    }
  }
  async commitTransaction(conn: DatabaseConnection): Promise<void> {
    await conn.executeQuery(CompiledQuery.raw("commit"));
  }
  async rollbackTransaction(conn: DatabaseConnection): Promise<void> {
    await conn.executeQuery(CompiledQuery.raw("rollback"));
  }
  async destroy(): Promise<void> {
    this.conn = undefined;
  }
}

function createNodePgliteDialect(client: PGlite): Dialect {
  return {
    createAdapter: () => new PostgresAdapter(),
    createDriver: () => new PgliteTestDriver(client),
    createQueryCompiler: () => new PostgresQueryCompiler(),
    createIntrospector: (db: Kysely<unknown>) => new PostgresIntrospector(db),
  };
}

function extractCookieHeader(res: Response): string {
  const getSetCookie = (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  const rawList = typeof getSetCookie === "function" ? getSetCookie.call(res.headers) : [];
  if (!rawList.length) {
    const single = res.headers.get("set-cookie");
    if (single) rawList.push(single);
  }
  return rawList
    .map((c) => c.split(";")[0]?.trim())
    .filter(Boolean)
    .join("; ");
}

describe("Better Auth + PGLite integration", () => {
  let pg: PGlite;
  let previewAuth: { handler: (req: Request) => Promise<Response> };
  let deployedAuth: { handler: (req: Request) => Promise<Response> };

  before(async () => {
    pg = new PGlite();
    const schemaSql = readFileSync(resolve(process.cwd(), "migrations/auth/0001_auth.sql"), "utf8");
    await pg.exec(schemaSql);

    const allowedHosts = [...PREVIEW_ALLOWED_HOSTS, "localhost", "127.0.0.1"];
    const trustedOrigins = [
      ...PREVIEW_ALLOWED_HOSTS,
      ...PREVIEW_ALLOWED_HOSTS.flatMap((h) => [`https://${h}`, `http://${h}`]),
      "http://localhost:8080",
      "https://mizan.example.com",
    ];

    previewAuth = betterAuth({
      baseURL: {
        allowedHosts,
        protocol: "auto",
        fallback: "http://localhost:8080",
      },
      secret: "integration-test-secret-0123456789abcdef0123456789abcdef",
      database: { dialect: createNodePgliteDialect(pg), type: "postgres" },
      trustedOrigins,
      emailAndPassword: { enabled: true },
      plugins: [
        genericOAuth({
          config: GROK_PROVIDERS.map(({ providerId, idp }) => ({
            providerId,
            clientId: PREVIEW_CLIENT_ID,
            clientSecret: PREVIEW_CLIENT_SECRET,
            authorizationUrl: "https://auth.grok.me/api/auth/oauth2/authorize",
            tokenUrl: "https://auth.grok.me/api/auth/oauth2/token",
            userInfoUrl: "https://auth.grok.me/api/auth/oauth2/userinfo",
            scopes: ["openid", "profile", "email"],
            authorizationUrlParams: { idp, prompt: "login" },
          })),
        }),
        bearer(),
      ],
    });

    deployedAuth = betterAuth({
      baseURL: "https://mizan.example.com",
      secret: "deployed-test-secret-0123456789abcdef0123456789abcdef",
      database: { dialect: createNodePgliteDialect(pg), type: "postgres" },
      trustedOrigins: ["https://mizan.example.com"],
      emailAndPassword: { enabled: true },
      plugins: [bearer()],
    });
  });

  after(async () => {
    await pg.close();
  });

  it("completes email sign-up, persists session across requests, and supports sign-out invalidation", async () => {
    const signUpRes = await previewAuth.handler(
      new Request("https://abc123.grok-sandbox.com/api/auth/sign-up/email", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://abc123.grok-sandbox.com",
          host: "abc123.grok-sandbox.com",
        },
        body: JSON.stringify({
          email: "zyad@example.com",
          password: "StrongPassword!123",
          name: "Zyad",
        }),
      }),
    );
    assert.equal(signUpRes.status, 200);
    const signUpBody = (await signUpRes.json()) as { token?: string; user?: { id: string; email: string } };
    assert.ok(signUpBody.user?.id);
    assert.equal(signUpBody.user?.email, "zyad@example.com");

    const cookie = extractCookieHeader(signUpRes);
    const bearerToken = signUpRes.headers.get("set-auth-token") ?? signUpBody.token;
    assert.ok(cookie || bearerToken, "Sign-up should yield a session cookie or bearer token");

    const sessionRes = await previewAuth.handler(
      new Request("https://abc123.grok-sandbox.com/api/auth/get-session", {
        headers: {
          ...(cookie ? { cookie } : {}),
          ...(bearerToken ? { authorization: `Bearer ${bearerToken}` } : {}),
        },
      }),
    );
    assert.equal(sessionRes.status, 200);
    const sessionBody = (await sessionRes.json()) as { user?: { id: string; email: string } } | null;
    assert.equal(sessionBody?.user?.id, signUpBody.user?.id);

    const signOutRes = await previewAuth.handler(
      new Request("https://abc123.grok-sandbox.com/api/auth/sign-out", {
        method: "POST",
        headers: {
          origin: "https://abc123.grok-sandbox.com",
          ...(cookie ? { cookie } : {}),
          ...(bearerToken ? { authorization: `Bearer ${bearerToken}` } : {}),
        },
      }),
    );
    assert.equal(signOutRes.status, 200);

    const afterSignOut = await previewAuth.handler(
      new Request("https://abc123.grok-sandbox.com/api/auth/get-session", {
        headers: {
          ...(bearerToken ? { authorization: `Bearer ${bearerToken}` } : {}),
        },
      }),
    );
    const afterBody = await afterSignOut.json();
    assert.equal(afterBody, null);
  });

  it("isolates sessions when switching accounts and rejects duplicate sign-up & expired sessions", async () => {
    const dupRes = await previewAuth.handler(
      new Request("http://localhost:8080/api/auth/sign-up/email", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:8080" },
        body: JSON.stringify({
          email: "zyad@example.com",
          password: "AnotherPassword!123",
          name: "Attacker",
        }),
      }),
    );
    assert.ok(dupRes.status >= 400);

    const user2SignUp = await previewAuth.handler(
      new Request("http://localhost:8080/api/auth/sign-up/email", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:8080" },
        body: JSON.stringify({
          email: "salma@example.com",
          password: "SalmaPassword!123",
          name: "Salma",
        }),
      }),
    );
    assert.equal(user2SignUp.status, 200);
    const user2Data = (await user2SignUp.json()) as { token?: string; user: { id: string; email: string } };

    const user1SignIn = await previewAuth.handler(
      new Request("http://localhost:8080/api/auth/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:8080" },
        body: JSON.stringify({
          email: "zyad@example.com",
          password: "StrongPassword!123",
        }),
      }),
    );
    assert.equal(user1SignIn.status, 200);
    const user1Data = (await user1SignIn.json()) as { token?: string; user: { id: string; email: string } };
    assert.notEqual(user1Data.user.id, user2Data.user.id);

    const s1 = (await (
      await previewAuth.handler(
        new Request("http://localhost:8080/api/auth/get-session", {
          headers: { authorization: `Bearer ${user1Data.token}` },
        }),
      )
    ).json()) as { user: { email: string } };
    const s2 = (await (
      await previewAuth.handler(
        new Request("http://localhost:8080/api/auth/get-session", {
          headers: { authorization: `Bearer ${user2Data.token}` },
        }),
      )
    ).json()) as { user: { email: string } };
    assert.equal(s1.user.email, "zyad@example.com");
    assert.equal(s2.user.email, "salma@example.com");

    await pg.query(`UPDATE "session" SET "expiresAt" = NOW() - INTERVAL '1 hour' WHERE "userId" = $1`, [
      user2Data.user.id,
    ]);
    const expiredRes = await previewAuth.handler(
      new Request("http://localhost:8080/api/auth/get-session", {
        headers: { authorization: `Bearer ${user2Data.token}` },
      }),
    );
    assert.equal(await expiredRes.json(), null);
  });

  it("handles OAuth error callbacks, rejects unauthenticated account linking, and enforces preview vs deployed origin policies", async () => {
    const oauthErr = await previewAuth.handler(
      new Request("https://abc123.grok-sandbox.com/api/auth/oauth2/callback/grok-google?error=access_denied", {
        headers: { host: "abc123.grok-sandbox.com" },
      }),
    );
    assert.ok(oauthErr.status === 302 || oauthErr.status >= 400);
    assert.equal(oauthErr.headers.get("set-auth-token"), null);

    const oauthInit = await previewAuth.handler(
      new Request("https://demo99.grok-sandbox.com/api/auth/sign-in/oauth2", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://demo99.grok-sandbox.com",
          host: "demo99.grok-sandbox.com",
        },
        body: JSON.stringify({ providerId: "grok-google", callbackURL: "/" }),
      }),
    );
    assert.equal(oauthInit.status, 200);
    const initJson = (await oauthInit.json()) as { url?: string };
    assert.ok(initJson.url?.includes("redirect_uri=https%3A%2F%2Fdemo99.grok-sandbox.com%2F"));
    assert.ok(initJson.url?.includes("idp=google"));

    const linkFail = await previewAuth.handler(
      new Request("http://localhost:8080/api/auth/oauth2/link", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:8080" },
        body: JSON.stringify({ providerId: "grok-x", callbackURL: "/" }),
      }),
    );
    assert.ok(linkFail.status >= 400);

    const badOrigin = await deployedAuth.handler(
      new Request("https://mizan.example.com/api/auth/sign-in/email", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://evil-sibling.example.com",
        },
        body: JSON.stringify({ email: "zyad@example.com", password: "StrongPassword!123" }),
      }),
    );
    assert.equal(badOrigin.status, 403);

    const goodOrigin = await deployedAuth.handler(
      new Request("https://mizan.example.com/api/auth/sign-in/email", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://mizan.example.com",
        },
        body: JSON.stringify({ email: "zyad@example.com", password: "StrongPassword!123" }),
      }),
    );
    assert.equal(goodOrigin.status, 200);
  });
});
