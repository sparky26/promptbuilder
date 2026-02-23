export const briefFieldDefinitions = {
  objective: {
    patterns: [/\bobjective\b/, /\bgoal\b/, /\bi need\b/, /\bi want\b/, /\btask\b/],
    aliases: ['objective']
  },
  audience: {
    patterns: [/\baudience\b/, /\bfor\b/, /\btarget\b/, /\breaders?\b/, /\busers?\b/],
    aliases: ['audience']
  },
  context: {
    patterns: [/\bcontext\b/, /\bbackground\b/, /\bsource\b/, /\bdata\b/, /\binput\b/],
    aliases: ['context']
  },
  constraints: {
    patterns: [/\bconstraint\b/, /\bmust\b/, /\bshould\b/, /\blimit\b/, /\bavoid\b/],
    aliases: ['constraints']
  },
  nonGoals: {
    patterns: [/\bnon-goals?\b/, /\bout of scope\b/, /\bdo not\b/, /\bdon't\b/, /\bnot include\b/],
    aliases: ['non-goal', 'non-goals', 'non goals']
  },
  outputFormat: {
    patterns: [/\boutput\s*format\b/, /\bformat\b/, /\bjson\b/, /\bmarkdown\b/, /\btable\b/],
    aliases: ['output format']
  },
  tone: {
    patterns: [/\btone\b/, /\bvoice\b/, /\bstyle\b/, /\bformal\b/, /\bcasual\b/],
    aliases: ['tone']
  },
  examples: {
    patterns: [/\bexample\b/, /\bsample\b/, /\bfew-shot\b/, /\blike this\b/],
    aliases: ['example', 'examples']
  },
  acceptanceCriteria: {
    patterns: [
      /\bacceptance\s*criteria\b/,
      /\bsuccess\s*criteria\b/,
      /\bdefinition of done\b/,
      /\bquality bar\b/
    ],
    aliases: ['acceptance criteria']
  }
};

export const briefFieldKeys = Object.keys(briefFieldDefinitions);

export const briefFieldPatterns = Object.fromEntries(
  Object.entries(briefFieldDefinitions).map(([key, definition]) => [key, definition.patterns])
);

export const explicitBriefFieldAliasMap = Object.fromEntries(
  Object.entries(briefFieldDefinitions).flatMap(([key, definition]) =>
    [key, ...(definition.aliases || [])].map((alias) => [alias, key])
  )
);

export const stageDefinitions = {
  objective: {
    key: 'objective',
    label: 'Objective',
    required: true,
    requiredFields: ['task', 'successOutcome'],
    completionRules: [{ allOf: [{ fieldKey: 'objective', minConfidence: 0.45 }] }],
    doneCriteria:
      'Complete when the user clearly states what they want the model to do and what a successful result looks like.',
    followUpQuestion:
      'What exact outcome do you want, and how will you judge whether the answer is successful?'
  },
  audience: {
    key: 'audience',
    label: 'Audience',
    required: true,
    requiredFields: ['readerOrUser', 'skillLevelOrRole'],
    completionRules: [{ allOf: [{ fieldKey: 'audience', minConfidence: 0.4 }] }],
    doneCriteria:
      'Complete when the intended audience or end-user is named, including role, expertise level, or context.',
    followUpQuestion:
      'Who is the output for (role/experience level), and what do they already know?'
  },
  contextData: {
    key: 'contextData',
    label: 'Context/Data',
    required: true,
    requiredFields: ['background', 'inputsOrSources'],
    completionRules: [{ allOf: [{ fieldKey: 'context', minConfidence: 0.4 }] }],
    doneCriteria:
      'Complete when the user provides relevant background, source material, or data the model should use.',
    followUpQuestion:
      'What background information, source material, or data should the model use?'
  },
  constraints: {
    key: 'constraints',
    label: 'Constraints',
    required: true,
    requiredFields: ['limits', 'nonGoalsOrBoundaries'],
    completionRules: [
      {
        anyOf: [
          { fieldKey: 'constraints', minConfidence: 0.4 },
          { fieldKey: 'nonGoals', minConfidence: 0.35 }
        ]
      }
    ],
    doneCriteria:
      'Complete when hard constraints are clear (scope, tone, length, boundaries, or forbidden content).',
    followUpQuestion:
      'What constraints should I enforce (length, tone, boundaries, must/avoid requirements)?'
  },
  outputFormat: {
    key: 'outputFormat',
    label: 'Output Format',
    required: true,
    requiredFields: ['structure', 'deliveryStyle'],
    completionRules: [
      {
        anyOf: [
          { fieldKey: 'outputFormat', minConfidence: 0.4 },
          { fieldKey: 'tone', minConfidence: 0.35 }
        ]
      }
    ],
    doneCriteria:
      'Complete when expected output structure is explicit (format, sections, bullets/table/json, etc.).',
    followUpQuestion:
      'How should the final answer be formatted (for example: bullets, table, JSON schema, sections)?'
  },
  qualityBar: {
    key: 'qualityBar',
    label: 'Quality Bar',
    required: false,
    requiredFields: ['evaluationCriteria'],
    completionRules: [{ allOf: [{ fieldKey: 'acceptanceCriteria', minConfidence: 0.35 }] }],
    doneCriteria:
      'Complete when measurable quality criteria are provided (accuracy, depth, citations, checklist, edge cases).',
    followUpQuestion:
      'What quality bar should the response meet (e.g., depth, accuracy checks, citation style, acceptance criteria)?'
  },
  examples: {
    key: 'examples',
    label: 'Examples',
    required: false,
    requiredFields: ['sampleInputOrOutput'],
    completionRules: [{ allOf: [{ fieldKey: 'examples', minConfidence: 0.35 }] }],
    doneCriteria:
      'Complete when there is at least one example of desired (or undesired) input/output style.',
    followUpQuestion:
      'Do you have an example of a good output (or a bad one to avoid) so I can match style and quality?'
  }
};

export const requiredStageKeys = Object.values(stageDefinitions)
  .filter((stage) => stage.required)
  .map((stage) => stage.key);
