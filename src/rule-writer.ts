import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { config } from './config';
import { listRewardTypes } from './rules';
import { FIXED_OUTPUTS, RULE_VARIABLES } from './rule-variables';

/*
 * "Ask Claude" on the rule editor: an admin describes a deal in French or English and Claude writes
 * the rule. The rule only goes into the text box: it is checked and previewed like a typed one, and
 * nothing is saved until the admin saves it. Without ANTHROPIC_API_KEY the button is not shown.
 */

export const ruleWriterEnabled = () => config.anthropicApiKey !== '';

const Written = z.object({
  rule: z.string().describe('The rule: lines of `name = expression`, lines starting with # as notes.'),
  note: z.string().describe('One or two short sentences for the admin, in the language of the description: what was assumed, or what to check.'),
});

export type WrittenRule = z.infer<typeof Written>;
export type WriteResult = { ok: true; written: WrittenRule } | { ok: false; error: string };

// Stable, so it can be cached between calls; the reward types are listed in the user turn.
const SYSTEM = `You write promoter commission rules for an event ticketing app. A ticket promoter sells tickets with their promo codes; a rule works out, for one promoter on one event, their commission, a bonus, and rewards.

A rule is lines of \`name = expression\`. Lines starting with # are notes for people. Each name is an output; each expression is CEL (Google's Common Expression Language) and must give a number of 0 or more.

CEL as used here:
- Every number is a double: 5 and 5.0 are the same, and tickets_sold / 5 is a fraction (use floor() for whole steps).
- Arithmetic + - * /, comparisons, && || !, and the conditional a ? b : c.
- Extra functions: floor(x), ceil(x), round(x), min(a, b) or min(a, b, c), max(a, b) or max(a, b, c).
- Strings in single or double quotes; compare level with ==, like level == 'Gold'.
- No other functions, macros, lists, maps or loops.

Money is in dollars (commission = tickets_sold * 5.00 gives $5 per ticket). Commission and bonus are money; every other output is a count.

Example. Deal: "he sells 1 ticket, he gets 2 VIP (him and his +1); then a GA list spot for every 5 tickets sold; $5 commission per ticket."
# 2 VIP from the first ticket, a GA list spot every 5, $5 a ticket
commission  = tickets_sold * 5.00
vip_tickets = tickets_sold >= 1 ? 2 : 0
ga_list     = floor(tickets_sold / 5)

Write only the lines the deal talks about: lines left out keep the app's default. If the deal clearly gives no plain free tickets, add free_tickets = 0. Use only the variables and outputs listed in the request; if the deal needs a reward that is not listed, leave it out and say so in the note. Start with one # line that sums up the deal. Keep expressions short and readable.`;

function catalog(): string {
  const vars = RULE_VARIABLES.map((v) => `- ${v.name} (${v.type}): ${v.en}`).join('\n');
  const outputs = [
    ...FIXED_OUTPUTS.map((o) => `- ${o.name}: ${o.en}`),
    ...listRewardTypes().map((t) => `- ${t.key}: reward "${t.label_en}" (${t.label_fr}), a count`),
  ].join('\n');
  return `Variables a rule can read:\n${vars}\n\nOutputs a rule can give:\n${outputs}`;
}

let client: Anthropic | null = null;

/** Asks Claude for a rule from the admin's description. Never throws for API problems: they come back as text. */
export async function writeRule(description: string): Promise<WriteResult> {
  if (!ruleWriterEnabled()) return { ok: false, error: 'Writing rules for you needs ANTHROPIC_API_KEY.' };
  client ??= new Anthropic({ apiKey: config.anthropicApiKey, timeout: 90_000, maxRetries: 1 });
  try {
    const response = await client.messages.parse({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      output_config: { effort: 'medium', format: zodOutputFormat(Written) },
      messages: [
        {
          role: 'user',
          content: `${catalog()}\n\nThe deal, as the admin described it (French or English):\n<deal>\n${description}\n</deal>`,
        },
      ],
    });
    if (response.stop_reason === 'refusal') return { ok: false, error: 'Claude did not write this one. Try describing the deal differently.' };
    if (response.stop_reason === 'max_tokens' || !response.parsed_output) return { ok: false, error: 'Claude’s answer could not be read. Try again.' };
    return { ok: true, written: response.parsed_output };
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) return { ok: false, error: 'ANTHROPIC_API_KEY was refused. Check the key.' };
    if (err instanceof Anthropic.RateLimitError) return { ok: false, error: 'Too many requests to Claude right now. Try again in a minute.' };
    if (err instanceof Anthropic.APIConnectionError) return { ok: false, error: 'Claude could not be reached. Try again.' };
    if (err instanceof Anthropic.APIError) return { ok: false, error: `Claude could not be reached (${err.status ?? 'no answer'}). Try again.` };
    throw err;
  }
}
