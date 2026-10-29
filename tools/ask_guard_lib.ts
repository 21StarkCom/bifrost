/**
 * ask-guard: the classifier behind the stark-ops Stop hook (`ask_guard_hook.ts`)
 * that enforces the root rules' "Act, don't ask" section (`~/Code/CLAUDE.md`).
 *
 * `classifyEnding` reads the last assistant message of a turn and says whether
 * the turn ends on
 *   - `ask`: a permission question about a step the agent can take itself
 *     ("Should I …?", "Want me to …?", "Say go", "Ready to proceed?"), or
 *   - `defer`: a promise of a later step while the turn ends
 *     ("I will relaunch EI-2122 once PR #779 is approved.").
 *
 * It is tuned for few false positives. It reads only the last paragraph, drops
 * code, block quotes and quoted questions, skips a question the next sentence
 * answers, and passes a question whose step still needs the operator's GO
 * (a write you cannot undo, a hand-run terraform apply, publishing by hand, a
 * message to a person or channel, secret values, a major release) or whose
 * answer is the operator's (scope, taste, money, people). Pure: no I/O.
 */
import path from "node:path";
import { stateRoot } from "./asset_root_lib.ts";

export type Kind = "ask" | "defer";

export interface Verdict {
  block: boolean;
  kind?: Kind;
  /** The sentence that matched, trimmed to MAX_PHRASE characters. */
  phrase?: string;
  /** Why a matched sentence passes: the exemption group that fired. */
  exempt?: string;
}

const MAX_PHRASE = 200;

// A permission question about the agent's own next step. Each is tested on one
// lowercased sentence with straight apostrophes.
const ASK: RegExp[] = [
  /\b(?:should|shall) i\b.*[?:]\s*$/,
  /\b(?:should|shall) we (?:proceed|continue|go ahead|merge|ship|move on|start|kick off|run|apply|fix|file|release|deploy|push|land|launch|relaunch|retry|rerun|open|close|do (?:it|this|that|the))\b.*\?\s*$/,
  /\b(?:can|may) i (?:go ahead|proceed|continue|start)\b/,
  /\bwant me to\b/,
  /\bwould you like me to\b/,
  /\b(?:would you like|do you want) to (?:proceed|continue|go ahead|move forward)\b/,
  /\bdo you want (?:it|this|that|them|these|those) (?:done|fixed|filed|merged|shipped|applied|changed|created|updated|removed|released|run|launched|opened|closed)\b/,
  /\b(?:let me know|tell me|say|ping me) (?:if|whether|when) you(?:'d| would)? (?:want|like) me to\b/,
  /\b(?:let me know|tell me|say) (?:if|whether|when) you(?:'d| would)? (?:want|like) to (?:proceed|continue|go ahead|move forward)\b/,
  /\b(?:let me know|tell me|say) (?:if|whether|when) (?:i should|to (?:proceed|continue|go ahead|start|merge|ship))\b/,
  /\b(?:let me know|tell me) (?:if|whether|when) you want (?:it|this|that|them|these|those) (?:done|fixed|filed|merged|shipped|applied|changed|created|updated|removed|released|run|launched)\b/,
  /\bsay (?:the word|"?go"?|yes)\b/,
  /\b(?:give me|i need|waiting (?:for|on)) (?:a|the|your) (?:"?go"?|ok|okay|approval|green light|confirmation|sign-off)\b/,
  /\bready (?:to (?:proceed|go|merge|ship|continue|start)\s*\?|for me to\b)/,
  /\b(?:ok|okay|good|fine|alright) (?:to|if i) (?:proceed|continue|go ahead|merge|ship|push|start|apply|run|release)\b.*\?\s*$/,
  /^(?:proceed|go ahead|continue|merge|ship it|go)\s*\?$/,
  /\bif you(?:'d| would)? (?:like|want)\s*,? i (?:can|will|could)\b/,
  /\bi (?:can|could) (?:also )?[^.?!]* if you(?:'d| would)? (?:like|want)\b/,
];

// A promise of a later step at the end of the turn. "I will X once Y is approved."
const DEFER: RegExp[] = [
  /\b(?:i will|i'll|i am going to|i'm going to|i can)\b[^.?!]*\b(?:once|when|after|as soon as)\b[^.?!]*\b(?:approved|merged|green|passes|passed|lands|landed|finishes|finished|completes|completed|reviewed|ready|done|confirm|confirms|approve|approves)\b/,
];

// The steps that keep a GO (root rules, "These still need a GO") and the
// answers that belong to the operator ("Decide what you can decide").
const EXEMPT: [string, RegExp][] = [
  ["irreversible", /\b(?:delete|deleting|drop|dropping|destroy|destroying|purge|wipe|erase|truncate|force[- ]?push|irreversibl\w*|permanent(?:ly)?|cannot be undone|can't be undone|can not be undone|overwrite|reset --hard|hard reset)\b|\brm -rf\b/],
  ["terraform apply by hand", /\b(?:terraform|tofu) apply\b|\bapply\w*\b[^.?!]*\b(?:by hand|manually)\b/],
  ["publishing", /\bpublish\w*\b/],
  ["message to a person or channel", /\b(?:slack|e-?mail|dm|direct message|channel|ping|notify|announce\w*|whatsapp|text message)\b|\b(?:send|post|write|draft)\b[^.?!]*\b(?:message|note|reply|announcement)\b|\b(?:reply|respond|write) to\b|\b(?:in your name|on your behalf|from your account)\b|(?:^|\s)#[a-z][\w-]*|(?:^|\s)@[a-z][\w.-]*(?![\w./-])/],
  ["secret values", /\b(?:secrets?|tokens?|api[- ]?keys?|key ?files?|private keys?|passwords?|passphrases?|credentials?|mimir|secret manager|keychain)\b/],
  ["major release", /\b(?:major (?:release|version|bump)|1\.0(?:\.0)?|v1\.0)\b/],
  ["money", /\$\s?\d|\b(?:cost|costs|spend|spending|budget|pay|paid|purchase|buy|billing|invoice|price|pricing|subscription|credits)\b/],
  ["people", /\b(?:hire|hiring|interview|invite|onboard|offboard|reassign|assign (?:it |this |that )?to)\b/],
  ["scope or taste", /\b(?:prefer|preference|rather|naming|wording|tone|taste|look and feel|colou?r|font|scope|priority|prioriti[sz]e|roadmap|name (?:it|this|that|them|the))\b|\bwhich (?:one|option|approach|name|design|layout|style)\b/],
];

// A sentence that answers the question before it, so that question is
// rhetorical: "Should I worry? No: it is harmless."
const ANSWERED = /^(?:yes|no|nope|yep|yeah|not really|short answer)\b/;

/** Lowercase, straight quotes, and code, block quotes and quoted questions gone. */
export function normalize(text: string): string {
  return text
    .replace(/```[\s\S]*?(?:```|$)/g, "\n")
    .replace(/`[^`\n]*`/g, "x")
    .replace(/^[ \t]*>.*$/gm, "")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/"[^"\n]*\?[^"\n]*"/g, "x")
    .toLowerCase();
}

/** The last paragraph, plus the one before it when the last is only a list. */
export function tail(text: string): string {
  const paras = text.split(/\n[ \t]*\n/).map((p) => p.trim()).filter(Boolean);
  if (paras.length === 0) return "";
  const last = paras[paras.length - 1];
  const isList = last.split("\n").every((l) => /^\s*(?:[-*+]|\d+[.)])\s/.test(l));
  return isList && paras.length > 1 ? `${paras[paras.length - 2]}\n${last}` : last;
}

/** Sentences of the tail, split at end punctuation and at line breaks. */
export function sentences(text: string): string[] {
  return text
    .split(/\n+|(?<=[.?!])\s+/)
    .map((s) => s.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "").replace(/^[*_]+|[*_]+$/g, "").trim())
    .filter(Boolean);
}

function exemption(sentence: string): string | undefined {
  for (const [name, re] of EXEMPT) if (re.test(sentence)) return name;
  return undefined;
}

function clip(s: string): string {
  return s.length > MAX_PHRASE ? `${s.slice(0, MAX_PHRASE - 1)}…` : s;
}

/** Classify the last assistant message of a turn. */
export function classifyEnding(message: unknown): Verdict {
  if (typeof message !== "string" || !message.trim()) return { block: false };
  const ss = sentences(tail(normalize(message)));
  for (let i = ss.length - 1; i >= 0; i--) {
    const s = ss[i];
    if (!ASK.some((re) => re.test(s))) continue;
    if (i + 1 < ss.length && ANSWERED.test(ss[i + 1])) continue;
    const exempt = exemption(s);
    return exempt ? { block: false, kind: "ask", phrase: clip(s), exempt } : { block: true, kind: "ask", phrase: clip(s) };
  }
  // A deferral counts only at the very end: the last two sentences.
  for (const s of ss.slice(-2).reverse()) {
    if (!DEFER.some((re) => re.test(s))) continue;
    const exempt = exemption(s);
    return exempt ? { block: false, kind: "defer", phrase: clip(s), exempt } : { block: true, kind: "defer", phrase: clip(s) };
  }
  return { block: false };
}

/** True when the Stop input shows background work or crons the session watches. */
export function watching(input: { background_tasks?: unknown; session_crons?: unknown }): boolean {
  const some = (v: unknown) =>
    Array.isArray(v) ? v.length > 0 : v !== null && typeof v === "object" ? Object.keys(v).length > 0 : typeof v === "number" ? v > 0 : false;
  return some(input.background_tasks) || some(input.session_crons);
}

const RULES = "the root rules' \"Act, don't ask\" (~/Code/CLAUDE.md)";
const KEPT =
  'the step is on the "These still need a GO" list (a write you cannot undo, a hand-run terraform apply, publishing by hand, ' +
  "a message to a person or channel the request did not name, secret values), or the answer belongs to the operator " +
  "(scope, taste, money, people, words sent in their name)";

/** The block reason Claude reads before it continues. */
export function reasonFor(kind: Kind, phrase: string): string {
  if (kind === "defer") {
    return (
      `ask-guard: your reply ends the turn on a later step: "${phrase}". Per ${RULES}, keep going while work remains: ` +
      "watch the wait in the background (Bash run_in_background or Monitor) and continue when it ends, or start the next item. " +
      "End the turn only when the task is done or each open item waits on the operator, and say which. " +
      "The hook lets your next stop through."
    );
  }
  return (
    `ask-guard: your reply ends on a permission question: "${phrase}". Per ${RULES}, the request is the GO: ` +
    "take that step now and report what you did. " +
    `If ${KEPT}, end the turn again with that one question; the hook lets your next stop through.`
  );
}

/** Where the hook appends one JSON line per block, and the metric reads them. */
export function blockLogPath(): string {
  return path.join(stateRoot(), "ask-guard", "blocks.jsonl");
}

export interface BlockLine {
  time: string;
  session_id: string;
  cwd: string;
  kind: Kind;
  phrase: string;
}
