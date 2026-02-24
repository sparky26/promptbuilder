import { useState } from 'react';
import { AssistantMarkdown } from '../utils/markdown';

const CopyIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M16 1H6a2 2 0 0 0-2 2v12h2V3h10V1Zm3 4H10a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Zm0 16H10V7h9v14Z" />
  </svg>
);

export const MessageList = ({ loading, messages }) => {
  const [copiedMessageId, setCopiedMessageId] = useState(null);

  const copyMessage = async (id, content) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedMessageId(id);
      setTimeout(() => {
        setCopiedMessageId((currentId) => (currentId === id ? null : currentId));
      }, 1400);
    } catch {
      setCopiedMessageId(null);
    }
  };

  return (
    <>
      {messages.map((message) => (
        <article key={message.id} className={`message-row ${message.role}`}>
          <span className="avatar" aria-hidden="true">
            {message.role === 'assistant' ? 'AI' : 'You'}
          </span>
          <div className="message-content">
            <div className={`bubble ${message.role}`}>
              {message.role === 'assistant' ? (
                <AssistantMarkdown content={message.content} />
              ) : (
                <p className="user-content">{message.content}</p>
              )}
            </div>
            <button
              type="button"
              className="copy-message-button"
              onClick={() => copyMessage(message.id, message.content)}
              aria-label={`Copy ${message.role} message`}
              title="Copy message"
            >
              <CopyIcon />
              <span>{copiedMessageId === message.id ? 'Copied' : 'Copy'}</span>
            </button>
          </div>
        </article>
      ))}
      {loading ? (
        <article className="message-row assistant" aria-live="polite" aria-label="assistant is thinking">
          <span className="avatar" aria-hidden="true">
            AI
          </span>
          <div className="bubble assistant">
            <p className="user-content">Thinking…</p>
          </div>
        </article>
      ) : null}
    </>
  );
};
