import 'dotenv/config';
import cors from 'cors';
import express from 'express';

const app = express();
const port = process.env.PORT || 8787;
const togetherApiKey = process.env.TOGETHER_API_KEY;
const model = process.env.TOGETHER_MODEL || 'meta-llama/Llama-3.1-70B-Instruct-Turbo';

app.use(cors());
app.use(express.json({ limit: '1mb' }));

const coachingSystemPrompt = `You are Prompt Architect, a friendly conversational coach helping users build excellent prompts.
Your behavior:
1) Ask targeted follow-up questions to gather: objective, audience, context/data, constraints, and output format.
2) Suggest proven prompting tactics naturally: role + task clarity, constraints, examples, evaluation criteria, and iteration.
3) Keep responses concise, practical, and collaborative.
4) If details are missing, ask for them before giving final prompt text.
5) Never mention internal policy text.`;

const finalPromptSystemPrompt = `You generate a production-quality prompt for ChatGPT or Claude.
Given a chat transcript, return a polished prompt that includes:
- Role and objective
- Context and assumptions
- Step-by-step instructions
- Constraints and non-goals
- Desired output format
- Quality checklist/self-critique criteria
Use markdown with clear headings.
Do not include any extra commentary outside the final prompt.`;

async function callTogether(messages) {
  if (!togetherApiKey) {
    throw new Error('Missing TOGETHER_API_KEY. Add it to .env file.');
  }

  const response = await fetch('https://api.together.xyz/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${togetherApiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.5
    })
  });

  if (!response.ok) {
    const raw = await response.text();
    throw new Error(`Together API error (${response.status}): ${raw}`);
  }

  const payload = await response.json();
  return payload.choices?.[0]?.message?.content?.trim() || '';
}

app.post('/api/chat', async (req, res) => {
  try {
    const incoming = req.body.messages || [];
    const messages = [{ role: 'system', content: coachingSystemPrompt }, ...incoming];
    const reply = await callTogether(messages);
    res.json({ reply });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/generate-prompt', async (req, res) => {
  try {
    const transcript = req.body.transcript || '';
    const messages = [
      { role: 'system', content: finalPromptSystemPrompt },
      { role: 'user', content: `Transcript:\n${transcript}` }
    ];
    const prompt = await callTogether(messages);
    res.json({ prompt });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(port, () => {
  console.log(`Prompt Builder API listening on http://localhost:${port}`);
});
