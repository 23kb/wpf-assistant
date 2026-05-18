// Tool definitions injected centrally by the Worker so all callers see the
// same shapes and the system prompt cache stays byte-identical.

export const TOOLS = [
  {
    name: 'read_doc',
    description:
      'Fetch a WPForms doc by slug. Only call when the snapshot lacks context — skip on settings pages where the target toggle/field text matches the user question.',
    input_schema: {
      type: 'object',
      properties: {
        slug: { type: 'string', description: 'A slug from the index in the system prompt.' },
      },
      required: ['slug'],
    },
  },
  {
    name: 'point_at',
    description:
      "Draw an arrow + bubble at an element on the user's current page. The selector MUST appear in the current page snapshot — never invent.",
    input_schema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'A CSS selector from the snapshot.' },
        message: { type: 'string', description: '1–2 short sentences telling the user what to do.' },
        text: {
          type: 'string',
          description:
            'OPTIONAL but REQUIRED when the selector matches several elements that differ only by their visible label (e.g. WPForms field-option tabs General / Advanced / Smart Logic, all sharing one class). Set this to the EXACT visible text of the one you mean, copied from the snapshot. Without it the widest element wins, not the one you want.',
        },
      },
      required: ['selector', 'message'],
    },
  },
  {
    name: 'ask_user',
    description: 'Ask a clarifying question. Use sparingly — only for genuinely ambiguous requests.',
    input_schema: {
      type: 'object',
      properties: { question: { type: 'string' } },
      required: ['question'],
    },
  },
  {
    name: 'done',
    description: 'Task complete OR conceptual answer with no UI action needed.',
    input_schema: {
      type: 'object',
      properties: { summary: { type: 'string' } },
      required: ['summary'],
    },
  },
];
