import { AssistantMarkdown } from '../utils/markdown';

export const MessageList = ({ loading, messages }) => (
  <>
    {messages.map((message) => (
      <article key={message.id} className={`message-row ${message.role}`}>
        <span className="avatar" aria-hidden="true">
          {message.role === 'assistant' ? 'AI' : 'You'}
        </span>
        <div className={`bubble ${message.role}`}>
          {message.role === 'assistant' ? (
            <AssistantMarkdown content={message.content} />
          ) : (
            <p className="user-content">{message.content}</p>
          )}
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
