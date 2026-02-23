const env = import.meta.env || {};

export const API_BASE_URL = (env.VITE_API_BASE_URL || (env.DEV ? 'http://localhost:8787' : '')).replace(
  /\/$/,
  ''
);

export const parseApiError = async (response, fallbackMessage) => {
  const contentType = response.headers.get('content-type') || '';
  let message = fallbackMessage;

  if (contentType.includes('application/json')) {
    const payload = await response.json();
    message = payload.error || payload.message || fallbackMessage;
  } else {
    const text = (await response.text()).trim();
    if (text) {
      message = text;
    }
  }

  const rawMessage = `${response.status} ${message}`;

  if (response.status >= 500) {
    return 'Something went wrong on our side while processing this request. Please try again in a moment.';
  }

  if (response.status === 429) {
    return 'Too many requests right now. Please wait a few seconds and try again.';
  }

  if (response.status === 400) {
    if (message.toLowerCase().includes('at least one non-empty user message')) {
      return 'Please add a message describing your goal, then try generating again.';
    }

    if (message.toLowerCase().includes('messages')) {
      return 'We could not read the conversation history. Please send another message and try again.';
    }

    return 'We need a little more input to continue. Add context or constraints, then try again.';
  }

  return rawMessage;
};
