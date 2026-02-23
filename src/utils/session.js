export const SESSION_STORAGE_KEY = 'promptbuilder:last-session';

export const serializeSession = (sessionMessages) =>
  JSON.stringify({
    savedAt: new Date().toISOString(),
    messages: sessionMessages
  });

export const parseStoredSession = (value) => {
  if (!value) return null;

  try {
    const payload = JSON.parse(value);
    const savedAt = typeof payload.savedAt === 'string' ? payload.savedAt : null;
    const savedMessages = Array.isArray(payload.messages) ? payload.messages : null;

    if (!savedMessages) return null;

    const validMessages = savedMessages.every(
      (message) =>
        message &&
        (message.role === 'assistant' || message.role === 'user') &&
        typeof message.content === 'string'
    );

    if (!validMessages) return null;

    return { savedAt, messages: savedMessages };
  } catch {
    return null;
  }
};
