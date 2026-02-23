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
4. Run both frontend and backend:
   ```bash
   npm run dev
   ```

- Frontend: `http://localhost:5173`
- API: `http://localhost:8787`

## API behavior

- `POST /api/chat`: conversational coaching mode to gather requirements.
- `POST /api/generate-prompt`: transforms the chat transcript into a detailed final prompt.

## Notes

- This repo intentionally leaves the API key as a placeholder.
- You can swap the Together model in `.env` via `TOGETHER_MODEL`.
