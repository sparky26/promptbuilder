import { useEffect, useMemo, useState } from 'react';
import { API_BASE_URL, parseApiError } from '../utils/api';
import { parseStoredSession, serializeSession, SESSION_STORAGE_KEY } from '../utils/session';

const STARTER_MESSAGE = {
  role: 'assistant',
  content:
    "Hi! I'm your Prompt Architect. Tell me what you want ChatGPT/Claude to help with, and I'll guide you through goal, context, constraints, and output format before generating a polished final prompt."
};

export const usePromptSession = () => {
  const [messages, setMessages] = useState([STARTER_MESSAGE]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const [stageProgress, setStageProgress] = useState(null);
  const [isProgressExpanded, setIsProgressExpanded] = useState(false);

  const transcript = useMemo(
    () =>
      messages
        .map((message) => `${message.role === 'assistant' ? 'Assistant' : 'User'}: ${message.content}`)
        .join('\n'),
    [messages]
  );

  const hasUserInput = messages.some(
    (message) => message.role === 'user' && Boolean(message.content.trim())
  );
  const hasFinalPrompt = messages.some(
    (message) => message.role === 'assistant' && message.content.startsWith('## Final Prompt')
  );
  const canGenerateFinalPrompt = !loading && hasUserInput;

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
        const message = await parseApiError(response, 'Failed to generate assistant response');
        throw new Error(message);
      }

      const payload = await response.json();
      setMessages((prev) => [...prev, { role: 'assistant', content: payload.reply }]);
      setStageProgress(payload.stageProgress || null);
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
        const message = await parseApiError(response, 'Failed to build final prompt');
        throw new Error(message);
      }

      const payload = await response.json();
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: `## Final Prompt\n\n${payload.prompt}`
        }
      ]);
      setStageProgress(payload.stageProgress || null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const startNewSession = () => {
    if (loading) return;
    setMessages([STARTER_MESSAGE]);
    setInput('');
    setError('');
    setStageProgress(null);
    setIsProgressExpanded(false);
  };

  const restoreLastSession = () => {
    if (loading) return;

    const stored = parseStoredSession(localStorage.getItem(SESSION_STORAGE_KEY));

    if (!stored) {
      setError('No previous session found in local storage.');
      return;
    }

    setMessages(stored.messages);
    setError('');
    setLastSavedAt(stored.savedAt);
    setStageProgress(null);
    setIsProgressExpanded(false);
  };

  useEffect(() => {
    const serialized = serializeSession(messages);
    localStorage.setItem(SESSION_STORAGE_KEY, serialized);

    const parsed = parseStoredSession(serialized);
    setLastSavedAt(parsed?.savedAt || null);
  }, [messages]);

  return {
    canGenerateFinalPrompt,
    error,
    hasFinalPrompt,
    input,
    isProgressExpanded,
    lastSavedAt,
    loading,
    messages,
    setInput,
    setIsProgressExpanded,
    stageProgress,
    transcript,
    buildFinalPrompt,
    restoreLastSession,
    sendMessage,
    setError,
    startNewSession
  };
};
