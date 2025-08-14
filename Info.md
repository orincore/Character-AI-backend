
# 📜 Backend Development Specification – AI Companion App (Node.js)

## Overview

Build a production-ready **Node.js (TypeScript)** backend for an **AI Companion Chat App** where users can:

* Sign up & log in with full profile info (first/last name, email, **username**, phone, gender, age, password).
* Authenticate with **username OR email OR phone** + password.
* Create **multiple AI characters** with customizable personality sliders.
* Toggle **18+ mode** per character (clean vs. mature, with strong server-side safeguards).
* Choose **character type** (girlfriend/boyfriend/friend/therapist/etc.).
* Maintain **persistent chat history** per user × character.
* Set visibility (**private / public / shareable**).
* **Share** characters; other users can chat with public/shareable chars.
* Generate/upload **avatars**, stored in **S3**.
* Handle **multi-user concurrent chats** (HTTP + WebSockets; streaming optional).
* **Ads after every 10 assistant replies** for free users; **no ads for premium**.
* Use **Together AI** (`NousResearch/Nous-Hermes-2-Mixtral-8x7B-DPO`) for text generation.
* Integrate **Supabase** (Auth + Postgres) & **AWS S3**.

---

## 0) Tech Stack

* **Runtime**: Node.js 20+, **TypeScript**
* **Framework**: **Express** (simple) or **NestJS** (recommended for large apps)
* **Auth & DB**: **Supabase** (Auth + Postgres with RLS)
* **File Storage**: **AWS S3** (avatars, media)
* **AI**: **Together AI** official Node SDK (`together-ai`)
* **Realtime**: **Socket.IO** (chat streaming & presence)
* **Caching/Queues (optional)**: **Redis** (rate limits, hot context, background jobs)
* **Observability**: pino/winston logs; OpenTelemetry optional
* **Security**: helmet, CORS, rate limiting, input validation (zod/class-validator)
* **Build/Tooling**: tsup/ts-node, ESLint, Prettier
* **CI/CD**: GitHub Actions; Docker image

---

## 1) Auth & User Profile

### Signup fields (server validates & stores):

* `first_name` (required), `last_name` (required)
* `email` (required, unique)
* `username` (required, unique)
* `phone_number` (required, unique)
* `gender` (`male|female|other`, required)
* `age` (required; enforce `>= 18` if enabling 18+ features)
* `password` (required; hashed by Supabase Auth when using email/phone auth)

> **Approach**
> Use **Supabase Auth** for primary identity (email/password and/or phone).
> Store **username** and additional profile fields in a **public `app_profiles`** table keyed by `auth.users.id`.

### Login options

* Custom `/auth/login` endpoint that accepts `{ identifier, password }` where `identifier` is **username | email | phone**.
* Resolve `identifier` → find `auth users` via:

  * **email**: signInWithPassword
  * **phone**: signInWithPassword (phone flow)
  * **username**: lookup `app_profiles.username -> user_id`, then log in by **email** associated to that `user_id` (store email in profile), or perform a Supabase Admin server-side token exchange.
* **JWT** from Supabase; backend trusts and reads claims (`sub` as `user_id`).
* Optional **refresh token** handled by Supabase SDK.

### Tables (Auth/Profile)

```sql
-- Mirrors plan & profile info; id == auth.users.id
create table if not exists app_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  first_name text not null,
  last_name text not null,
  email text not null unique,
  username text not null unique,
  phone_number text not null unique,
  gender text not null check (gender in ('male','female','other')),
  age int not null check (age >= 13), -- gate 18+ features separately
  plan text not null default 'free',   -- 'free' | 'premium'
  created_at timestamptz default now()
);

-- Ensure RLS & policies as needed (read own row, admin read/all).
```

> **Signup flow**:

1. `supabase.auth.signUp({ email/phone, password })`
2. On success, insert into `app_profiles` with **user\_id** and all extra fields.
3. Enforce **username/email/phone** uniqueness at DB-level.

---

## 2) Character Management

### Table: `characters`

```sql
create table if not exists characters (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text default '',
  character_type text not null, -- girlfriend|boyfriend|friend|therapist|celebrity|custom
  sliders jsonb not null default '{}'::jsonb, -- {shyness,flirtiness,humor,boldness,affection,sarcasm,positivity}
  nsfw_enabled boolean not null default false, -- 18+ toggle
  visibility text not null default 'private',  -- private|public|shareable
  avatar_url text,
  tags text[] default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index on characters (owner_id);
create index on characters (visibility);
```

### Share/Access

```sql
-- explicit shares (optional, besides "public"/"shareable" links)
create table if not exists character_shares (
  character_id uuid references characters(id) on delete cascade,
  shared_with_user uuid references auth.users(id) on delete cascade,
  can_write boolean not null default true,
  primary key (character_id, shared_with_user)
);
```

---

## 3) Chat System

### Sessions + Messages

```sql
create table if not exists chat_sessions (
  id uuid primary key default gen_random_uuid(),
  character_id uuid not null references characters(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text default '',
  ad_counter int not null default 0, -- assistant replies count
  created_at timestamptz default now()
);

create table if not exists chat_messages (
  id bigserial primary key,
  session_id uuid not null references chat_sessions(id) on delete cascade,
  role text not null check (role in ('system','user','assistant')),
  content text not null,
  created_at timestamptz default now()
);

create index on chat_messages (session_id, created_at);
```

### Behavior

* Persist **all** messages.
* When generating a reply, load last **N (e.g., 12–20)** messages + character persona.
* **Ads logic**: For **free** users, show an ad **every 10 assistant replies**.
  Increment `chat_sessions.ad_counter` after each assistant message; return `show_ad = (ad_counter % 10 === 0)` for free plan; **false** for premium.

---

## 4) Avatar & Media

* `POST /media/upload` (multipart, auth required).
  Upload to **S3** at:

  * `avatars/{character_id}/{uuid}.{ext}`
  * `media/{user_id}/{timestamp}_{filename}`
* Save file URL + metadata into DB (character `avatar_url` or a `media` table).

```sql
create table if not exists media (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  character_id uuid references characters(id) on delete set null,
  url text not null,
  kind text not null check (kind in ('avatar','image','audio','other')),
  created_at timestamptz default now()
);
```

---

## 5) API Endpoints (HTTP)

> All endpoints expect `Authorization: Bearer <supabase_jwt>` unless public.

### Auth

* `POST /auth/signup` → create Supabase user (email/phone), then insert `app_profiles`.
* `POST /auth/login` → `{identifier, password}` (username|email|phone), returns session/JWT.
* `POST /auth/refresh` → refresh via Supabase.
* `GET  /auth/me` → return profile + plan.

### Characters

* `POST   /characters` → create.
* `GET    /characters/:id` → details (respect visibility and access).
* `PUT    /characters/:id` → update (owner only).
* `DELETE /characters/:id` → delete (owner only).
* `GET    /characters/public` → list public (with search, tags, pagination).
* `POST   /characters/:id/share` → create/revoke share links or direct share to `user_id`.
* `POST   /characters/:id/set-adult` → toggle `nsfw_enabled` (owner only).

### Chat

* `POST /sessions` → `{ character_id, title? }` → creates session.
* `GET  /sessions/:id` → session meta.
* `GET  /sessions/:id/history?limit=...&before=...` → paginated messages.
* `POST /chat/send` → `{ session_id, message }` → returns `{ reply, show_ad, ad_counter }`.
* **WS** `/ws` → join `session_id`, send message events, stream tokens (optional).

### Media

* `POST /media/upload` → multipart; returns `{ url, id }`.
* `GET  /media/:id` → signed URL or direct (if public bucket).

---

## 6) AI Prompt Logic (Server)

* Build **system prompt** from:

  * Character: `name`, `character_type`, `description`, `sliders`, `nsfw_enabled`
  * Safety: **always** include boundaries (no illegal content; tasteful even in adult mode).
  * Style: Hinglish if user uses it; concise.
* Inject **last N messages** as chat history.

**Template (example)**:

```
You are {name}, a {character_type} companion. 
Traits (0–100): shyness={shyness}, flirtiness={flirtiness}, humor={humor}, boldness={boldness}, affection={affection}, sarcasm={sarcasm}, positivity={positivity}.
{adult_line}
Speak warmly and naturally (Hinglish if the user uses it). Stay in character; do not claim to be an AI. 
Keep replies short (1–3 small paragraphs). Avoid graphic sexual detail; refuse illegal or non-consensual content.
```

* `adult_line`:

  * **NSFW OFF**: “Adult mode is OFF. Keep things PG-13; no explicit sexual content.”
  * **NSFW ON**: “Adult mode is ON for consenting adults; keep it suggestive, respectful, and non-graphic. Never produce illegal content.”

**Server content guard** (pre/post): block minors/illegal themes; fall back with a refusal string.

---

## 7) Plans & Ads

* `app_profiles.plan`: `'free' | 'premium'`
* Ads logic in `/chat/send`:

  * Increment `ad_counter` on **assistant** reply.
  * `show_ad = (plan==='free' && ad_counter % 10 === 0)`
* Optional daily limits for free plan (DB counter + Redis).

---

## 8) Project Structure (TypeScript + Express)

```
/src
  /config        env, aws, supabase, together
  /middleware    auth, rateLimit, errorHandler
  /modules
    /auth        routes, controller, service
    /profiles    routes, controller
    /characters  routes, controller, service
    /sessions    routes, controller
    /chat        routes, controller, promptBuilder, guard
    /media       routes, controller, s3.service
  /ws            socket.ts (namespace: /chat, rooms per session)
  /utils         logger, types, validators (zod), pagination
  server.ts
  app.ts
/ prisma or /db (if you add Prisma)
/Dockerfile
/tsconfig.json
/.env.example
```

---

## 9) Environment Variables (`.env.example`)

```
# Supabase
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=   # server-only ops if needed

# Together
TOGETHER_API_KEY=

# AWS
AWS_REGION=ap-south-1
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
S3_BUCKET=

# App
PORT=5000
CORS_ORIGIN=*
NODE_ENV=development
```

---

## 10) Sample Code (Express + Together AI)

**`src/config/together.ts`**

```ts
import Together from "together-ai";
export const together = new Together({ apiKey: process.env.TOGETHER_API_KEY! });
```

**`src/middleware/auth.ts`** (reads Supabase JWT → `req.user`)

```ts
import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

export interface AuthedUser { user_id: string; plan: "free" | "premium"; }
declare global { namespace Express { interface Request { user?: AuthedUser } } }

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing token" });

  try {
    // Supabase JWT: read claims without verification (or verify via JWKS).
    const claims = jwt.decode(token) as any;
    const user_id = claims?.sub;
    if (!user_id) throw new Error("Invalid token");

    // Load plan from DB (cache recommended). Pseudo:
    // const plan = await getPlan(user_id);
    req.user = { user_id, plan: "free" }; // replace with real plan
    return next();
  } catch (e: any) {
    return res.status(401).json({ error: e.message });
  }
}
```

**`src/modules/chat/promptBuilder.ts`**

```ts
export function buildSystemPrompt(character: any) {
  const s = character.sliders || {};
  const adult = character.nsfw_enabled;
  const adultLine = adult
    ? "Adult mode is ON for consenting adults; keep it suggestive, respectful, and non-graphic. Never produce illegal content."
    : "Adult mode is OFF. Keep it PG-13; no explicit sexual content.";

  return `
You are ${character.name}, a ${character.character_type} companion.
Traits (0–100): shyness=${s.shyness??50}, flirtiness=${s.flirtiness??50}, humor=${s.humor??50}, boldness=${s.boldness??50}, affection=${s.affection??50}, sarcasm=${s.sarcasm??50}, positivity=${s.positivity??50}.
${adultLine}
Speak warmly and naturally (Hinglish if the user uses it). Stay in character; do not claim to be an AI.
Keep replies short (1–3 small paragraphs). Avoid graphic sexual detail; refuse illegal or non-consensual content.`;
}
```

**`src/modules/chat/guard.ts`** (lightweight server guard)

```ts
const banned = ["underage","minor","incest","rape","forced","bestiality"];
export const violatesGuard = (t: string) => {
  const s = t.toLowerCase();
  return banned.some(k => s.includes(k));
};
```

**`src/modules/chat/routes.ts`**

```ts
import { Router } from "express";
import { together } from "../../config/together";
import { requireAuth } from "../../middleware/auth";
import { buildSystemPrompt } from "./promptBuilder";
import { violatesGuard } from "./guard";
// import DB utils to fetch session, character, messages…

export const chatRouter = Router();

chatRouter.post("/send", requireAuth, async (req, res) => {
  const { session_id, message } = req.body as { session_id: string; message: string };
  if (!session_id || !message) return res.status(400).json({ error: "Missing fields" });

  // 1) Load session & character & plan (pseudo)
  // const session = await db.sessions.find(session_id, req.user!.user_id);
  // const character = await db.characters.find(session.character_id);

  // 2) Save user message
  // await db.messages.insert({ session_id, role:'user', content: message });

  if (violatesGuard(message)) {
    return res.status(400).json({ error: "Request violates safety policy" });
  }

  // 3) Load last N messages for context
  // const history = await db.messages.lastN(session_id, 14);

  const system = buildSystemPrompt(/*character*/{
    name: "Luna",
    character_type: "girlfriend",
    sliders: { shyness: 40, flirtiness: 70, humor: 60, boldness: 55, affection: 65, sarcasm: 20, positivity: 70 },
    nsfw_enabled: false
  });

  const messages = [{ role: "system", content: system },
    // ...history.map(m => ({ role: m.role, content: m.content })),
    { role: "user", content: message }
  ];

  const resp = await together.chat.completions.create({
    model: "NousResearch/Nous-Hermes-2-Mixtral-8x7B-DPO",
    messages
  });

  let reply = resp.choices[0].message.content || "…";
  if (violatesGuard(reply)) {
    reply = "Sorry, I can’t continue with that topic. Let’s switch to something else.";
  }

  // 4) Persist assistant reply & update ad counter
  // await db.messages.insert({ session_id, role: 'assistant', content: reply });
  // const adCounter = (session.ad_counter ?? 0) + 1;
  // await db.sessions.update(session_id, { ad_counter: adCounter });

  const isPremium = req.user!.plan === "premium";
  const adCounter = 10; // pretend it just hit
  const show_ad = !isPremium && adCounter % 10 === 0;

  return res.json({ reply, show_ad, ad_counter: adCounter });
});
```

**`src/modules/media/routes.ts`** (S3 upload sketch)

```ts
import { Router } from "express";
import multer from "multer";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { requireAuth } from "../../middleware/auth";
import { randomUUID } from "crypto";

const upload = multer({ limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB
const s3 = new S3Client({ region: process.env.AWS_REGION });

export const mediaRouter = Router();

mediaRouter.post("/upload", requireAuth, upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file" });
  const ext = req.file.originalname.split(".").pop() || "png";
  const key = `media/${req.user!.user_id}/${Date.now()}_${randomUUID()}.${ext}`;

  await s3.send(new PutObjectCommand({
    Bucket: process.env.S3_BUCKET!,
    Key: key,
    Body: req.file.buffer,
    ContentType: req.file.mimetype || "application/octet-stream",
  }));

  const url = `https://${process.env.S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
  // save to DB if needed
  return res.json({ url, key });
});
```

**`src/server.ts`**

```ts
import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { chatRouter } from "./modules/chat/routes";
import { mediaRouter } from "./modules/media/routes";

const app = express();
app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN?.split(",") || "*" }));
app.use(express.json({ limit: "1mb" }));

app.use("/chat", chatRouter);
app.use("/media", mediaRouter);
// TODO: /auth, /characters, /sessions

const port = Number(process.env.PORT || 5000);
app.listen(port, () => console.log(`API on http://localhost:${port}`));
```

---

## 11) Realtime (Socket.IO) – Optional

* Namespace `/chat`; room per `session_id`.
* Events:

  * `join_session` → join room
  * `user_message` → server calls Together AI (stream tokens via `assistant_token`)
  * `assistant_done` → final message, update ad counter & DB
* Presence indicators & typing events.

---

## 12) Security, Rate Limits, and RLS

* **RLS** on all tables; only owners see private data.
* **helmet**, **CORS**, **express-rate-limit** (e.g., 60 RPM/user).
* Validate all inputs (zod/class-validator).
* Sign/mint **share tokens** for `shareable` characters (short links).

---

## 13) Deployment

* **Dockerfile** for Node 20 Alpine; run `node dist/server.js`.
* **Secrets** via platform (Render/Railway/EC2/Vercel).
* Use **pm2** or platform process manager.
* CDN (CloudFront/Cloudflare) for media URLs (optional).

---

## 14) Testing

* Unit tests for prompt builder, guard, ads logic.
* E2E tests for `/auth`, `/characters`, `/chat/send`.
* Load test (k6/Artillery) to validate concurrency.

---
