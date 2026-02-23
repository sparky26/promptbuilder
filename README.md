# Prompt Builder

A React + Node prompt-building assistant that helps users shape their thoughts in chat, then produces a high-quality final prompt for ChatGPT/Claude.

## Why this approach

The app embeds practical prompt-engineering strategies:

- Clarify **role + objective**
- Gather **context and constraints**
- Specify **output format and quality bar**
- Encourage **iterative refinement**

## Stack

- React (Vite) for the chat UI
- Express API server
- Together AI Chat Completions API

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Add environment variables:
   ```bash
   cp .env.example .env
   ```
3. Set `TOGETHER_API_KEY` in `.env`.
4. Configure URLs:
   - In development, set `VITE_API_BASE_URL` (frontend -> backend target) and `PORT` (backend listener) in `.env`.
   - Defaults are `VITE_API_BASE_URL=http://localhost:8787` and `PORT=8787`.
5. Run both frontend and backend:
   ```bash
   npm run dev
   ```

- Frontend (dev): `http://localhost:5173`
- API (dev): `http://localhost:8787`

## URL configuration (dev vs prod)

- **Frontend to backend URL**: `src/App.jsx` calls `${VITE_API_BASE_URL}/api/...`.
  - Dev: keep `VITE_API_BASE_URL=http://localhost:8787`.
  - Prod: set `VITE_API_BASE_URL` to your deployed API origin (for example `https://api.example.com`).
- **Backend listener URL**: Express uses `PORT`.
  - Dev: `PORT=8787` by default.
  - Prod: set `PORT` from your hosting environment; frontend should point at that public API origin via `VITE_API_BASE_URL`.

## API behavior

- `POST /api/chat`: conversational coaching mode to gather requirements.
- `POST /api/generate-prompt`: transforms the chat transcript into a detailed final prompt.

## Notes

- This repo intentionally leaves the API key as a placeholder.
- You can swap the Together model in `.env` via `TOGETHER_MODEL`.
