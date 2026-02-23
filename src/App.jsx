import { useMemo, useState } from 'react';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:8787').replace(
  /\/$/,
  ''
);

const STARTER_MESSAGE = {
  role: 'assistant',
  content:
    "Hi! I'm your Prompt Architect. Tell me what you want ChatGPT/Claude to help with, and I'll guide you through goal, context, constraints, and output format before generating a polished final prompt."
};

export function App() {
  const [messages, setMessages] = useState([STARTER_MESSAGE]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const transcript = useMemo(
    () =>
      messages
        .map((m) => `${m.role === 'assistant' ? 'Assistant' : 'User'}: ${m.content}`)
        .join('\n'),
    [messages]
  );

  const sendMessage = async () => {
    const trimmed = input.trim();
    if (!trimmed || loading) return;

    const nextMessages = [...messages, { role: 'user', content: trimmed }];
    setMessages(nextMessages);
    setInput('');
    setError('');
    setLoading(true);

    try {
      const response = await fetch(`${API_BASE_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'coach', messages: nextMessages })
      });

      if (!response.ok) {
        const payload = await response.json();
        throw new Error(payload.error || 'Failed to generate assistant response');
      }

      const payload = await response.json();
      setMessages((prev) => [...prev, { role: 'assistant', content: payload.reply }]);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const buildFinalPrompt = async () => {
    if (loading) return;
    setError('');
    setLoading(true);

    try {
      const response = await fetch(`${API_BASE_URL}/api/generate-prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript, messages })
      });

      if (!response.ok) {
        const payload = await response.json();
        throw new Error(payload.error || 'Failed to build final prompt');
      }

      const payload = await response.json();
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: `## Final Prompt\n\n${payload.prompt}`
        }
      ]);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="app-shell">
      <header>
        <h1>Prompt Builder Agent</h1>
        <p>
          Conversationally shape your idea, then generate a detailed, reusable prompt for ChatGPT or
          Claude.
        </p>
      </header>

      <section className="chat-window">
        {messages.map((message, index) => (
          <article key={`${message.role}-${index}`} className={`bubble ${message.role}`}>
            <strong>{message.role === 'assistant' ? 'Architect' : 'You'}</strong>
            <p>{message.content}</p>
          </article>
        ))}
      </section>

      {error ? <p className="error">{error}</p> : null}

      <section className="composer">
        <textarea
          rows={3}
          placeholder="Describe your task, audience, and desired outcome..."
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              sendMessage();
            }
          }}
        />
        <div className="actions">
          <button onClick={sendMessage} disabled={loading || !input.trim()}>
            {loading ? 'Thinking…' : 'Send'}
          </button>
          <button onClick={buildFinalPrompt} disabled={loading || messages.length < 3}>
            Generate Final Prompt
          </button>
        </div>
      </section>
    </main>
  );
}
