# Z-Ai frontend (`src/zai/`)

Mounted at **`/zai`** via `src/routes/zai.tsx` inside the host Mizan Finance
Vite/TanStack Start app. See `../../zai/docs/architecture.md` for why it lives
here instead of a separate project, and `../../zai/README.md` for the full
Z-Ai project map (backend, infra, docs, `/cfsa` skill).

## Layout

```
src/zai/
├── App.tsx                 # root shell: wires every sheet/popover together
├── types.ts                # Chat/Message/Attachment/Settings/Model contracts
├── models.ts                # 27-model catalog migrated from the reference file
├── components/              # Sidebar, Topbar, Composer, MessageItem, and all 14 sheets
├── lib/                     # store (Zustand), markdown, search, files, backup, toast, mock-stream
├── styles/                  # tokens.css (themes) + zai.css (components)
└── data/cfsa-latest.json    # snapshot of the latest /cfsa report, shown in Security Center
```

## Local demo mode

There is no live backend wired into this sandbox (no Postgres/Redis/model
provider credentials — see `../../zai/docs/security.md` "Known gaps"). The UI
is fully interactive against:

- `lib/store.ts` — a real Zustand store persisted to `localStorage` (chats,
  messages, settings, favorites, usage).
- `lib/mock-stream.ts` — a labeled demo SSE-shaped generator standing in for
  `POST /api/v1/chats/:id/messages/stream` (see the real implementation in
  `zai/apps/api/src/messages/messages.controller.ts`).

Every other behavior (theming, accessibility, Markdown sanitization, search,
export/import, attachment validation) runs against the real implementation,
not a stub — only the "talk to a model provider" step is mocked, because that
step requires provider credentials this sandbox does not have.
