import { createElement } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';

export const markdownSanitizeSchema = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames || []),
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'del',
    'table',
    'thead',
    'tbody',
    'tr',
    'th',
    'td'
  ],
  attributes: {
    ...defaultSchema.attributes,
    a: [...(defaultSchema.attributes?.a || []), 'target', 'rel'],
    code: [...(defaultSchema.attributes?.code || []), 'className']
  }
};

const markdownComponents = {
  a: ({ href, children, ...props }) =>
    createElement(
      'a',
      {
        ...props,
        href,
        target: '_blank',
        rel: 'noreferrer'
      },
      children
    )
};

export const AssistantMarkdown = ({ content }) =>
  createElement(
    ReactMarkdown,
    {
      className: 'assistant-markdown',
      remarkPlugins: [remarkGfm],
      rehypePlugins: [[rehypeSanitize, markdownSanitizeSchema]],
      components: markdownComponents
    },
    content
  );
