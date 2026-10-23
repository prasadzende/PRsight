// Every prompt the app sends to an AI model lives in this file, and only here.
// Edit the wording here; the code fills the {{placeholders}} with fill().
// Keep the rules in the explain prompt in step with the data model in ./schema.ts.

export const PROMPTS = {
  /** "Explain This Report with AI" — the main request. */
  explain: {
    system: [
      'You help a code reviewer understand several related pull requests.',
      'Write in plain British English for someone new to the feature: short sentences, no unexplained jargon.',
      'You get a rule-based report (links between files, findings, PR descriptions, ticket text, team rules).',
      'For tldr write 2 to 4 short sentences, each one separate point (the app shows each sentence as a bullet). Start each with a capital letter and end it with a full stop.',
      'Do not invent links. Explain the links you are given, in one or two sentences each, keyed by link id.',
      'You may add at most 8 extra findings, but each must cite a "path" that appears in the input files, and a line if you can.',
      'Reply with ONE JSON object that matches the JSON Schema you are given. Use the exact ids from the input for prs, links and checklistOrder. No prose outside the JSON.',
    ].join('\n'),

    /** Sent once when the first reply fails validation. Placeholders: input, issues, previous. */
    repair: [
      '{{input}}',
      '',
      'Your previous reply did not match the schema. Problems:',
      '{{issues}}',
      '',
      'Previous reply:',
      '{{previous}}',
      '',
      'Return the corrected JSON object only.',
    ].join('\n'),

    /** How much of the failed reply is quoted back in the repair prompt. */
    repairQuoteChars: 8000,
    /** Characters of team rules included in the input. */
    teamRulesChars: 6000,
  },

  /** Structured output wrappers used by the providers. */
  structured: {
    /** Claude (API, Foundry, Bedrock, Vertex): the forced tool that carries the reply. */
    toolName: 'report_notes',
    toolDescription: 'Return the report notes in the required shape.',
    /** Claude Code CLI has no schema option, so the schema is appended to the system prompt. Placeholders: system, schema. */
    cliSystem: '{{system}}\n\nJSON Schema for your reply:\n{{schema}}',
  },

  /** Settings › AI › Test Connection. */
  test: {
    system: 'Reply with the single word OK.',
    user: 'Say OK.',
  },
} as const;

/** Replace {{name}} placeholders. Throws if the template uses a name that was not given, so typos show up in tests. */
export function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => {
    if (!(k in values)) throw new Error(`Prompt placeholder {{${k}}} has no value.`);
    return values[k];
  });
}

/** Names of the placeholders a template uses (for tests). */
export const placeholders = (template: string): string[] => [...template.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]);
