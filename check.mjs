#!/usr/bin/env node
/* ZIPA POKER brand kit — adherence checker.
   No dependencies. Node 18+.

     node check.mjs                    # contrast matrix only
     node check.mjs poster.html ...    # matrix + lint every file given
     node check.mjs --quiet page.html  # only report failures

   What it enforces, and why each one is machine-checkable rather than a matter of taste:

     1. No raw hex in markup. Colour lives in tokens/colors.css so a hex change stays a
        one-line change. This mirrors _adherence.oxlintrc.json, which does the same job
        for .jsx/.js in the design system itself.
     2. Every var(--token) actually exists in tokens/*.css. A typo'd token is silently
        transparent or inherited — it does not error, it just renders wrong.
     3. Contrast, computed rather than eyeballed. 8 contexts x 6 text roles. Gold on ivory
        is 2.96:1; no screenshot review catches that, arithmetic does.
     4. The lexicon red lines. These carry legal risk, not only tonal risk: the
        association's standing rests on being a competition, not gambling. Pieces declare
        data-channel="ad", "organic" or "internal"; undeclared pieces are checked as ads.
     5. Casing and emoji rules from readme.md's CONTENT FUNDAMENTALS.
     6. The two fixed legal lines, as advisories — the competition-standing line and the
        D07 18+ line. Advisory because which surfaces need them is a judgement call.

   The contrast matrix runs against the tokens alone, so it is worth running after any edit
   to colors.css even when no page changed. */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const TOKENS_DIR = existsSync(join(HERE, "tokens"))
  ? join(HERE, "tokens")
  : join(HERE, "..", "tokens");

/* ── token parsing ───────────────────────────────────────────────────────────
   One base map from :root, plus one override map per [data-context="…"] block.
   A context names no colour values of its own — it only re-points roles — so the
   override map is always small and always resolves back into the base map. */

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

function parseTokens() {
  const base = new Map();
  const contexts = new Map();
  if (!existsSync(TOKENS_DIR)) {
    console.error(`cannot find tokens/ (looked in ${TOKENS_DIR})`);
    process.exit(2);
  }
  for (const file of readdirSync(TOKENS_DIR).filter((f) => f.endsWith(".css"))) {
    const css = stripComments(readFileSync(join(TOKENS_DIR, file), "utf8"));
    const blockRe = /(:root|\[data-context="([a-z-]+)"\])\s*\{([^}]*)\}/g;
    let block;
    while ((block = blockRe.exec(css))) {
      const ctx = block[2] || null;
      const target = ctx
        ? contexts.get(ctx) || contexts.set(ctx, new Map()).get(ctx)
        : base;
      const declRe = /(--[A-Za-z0-9-]+)\s*:\s*([^;]+);/g;
      let decl;
      while ((decl = declRe.exec(block[3]))) {
        target.set(decl[1], decl[2].trim());
      }
    }
  }
  return { base, contexts };
}

/* Resolve a token through however many var() hops it takes. Returns a colour
   string or null when the chain ends somewhere that is not a colour (rgba(),
   a font stack, a length). */
function resolve(name, base, ctx) {
  const seen = new Set();
  let value = (ctx && ctx.get(name)) ?? base.get(name);
  while (value && !seen.has(value)) {
    seen.add(value);
    const m = /^var\((--[A-Za-z0-9-]+)\s*(?:,.*)?\)$/.exec(value.trim());
    if (!m) break;
    const next = (ctx && ctx.get(m[1])) ?? base.get(m[1]);
    if (next === undefined) return null;
    value = next;
  }
  return value ? value.trim() : null;
}

/* ── contrast ────────────────────────────────────────────────────────────── */

function toRgb(value) {
  if (!value) return null;
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  }
  return null; /* rgba() and friends: not comparable without a backdrop */
}

function luminance([r, g, b]) {
  const f = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(fg, bg) {
  const a = toRgb(fg);
  const b = toRgb(bg);
  if (!a || !b) return null;
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/* --text-accent is red on a dark ground at display sizes only — readme.md says never
   body — so it is held to the 3:1 graphics threshold rather than 4.5:1. Everything
   else is body-capable and held to 4.5:1. */
const TEXT_ROLES = [
  { token: "--text-primary", min: 4.5 },
  { token: "--text-secondary", min: 4.5 },
  { token: "--text-muted", min: 4.5 },
  { token: "--text-brand-mark", min: 4.5 },
  { token: "--text-brand-read", min: 4.5 },
  { token: "--text-accent", min: 3.0, note: "display sizes only" },
];

function contrastMatrix({ base, contexts }, quiet) {
  const rows = [];
  let failures = 0;
  for (const [name, ctx] of contexts) {
    const ground = resolve("--surface-page", base, ctx);
    for (const role of TEXT_ROLES) {
      const fg = resolve(role.token, base, ctx);
      const ratio = contrast(fg, ground);
      const ok = ratio === null ? null : ratio >= role.min;
      if (ok === false) failures++;
      rows.push({ context: name, role: role.token, fg, ground, ratio, ok, note: role.note });
    }
  }
  if (!quiet || failures) {
    console.log(`\ncontrast matrix — ${contexts.size} contexts x ${TEXT_ROLES.length} roles = ${rows.length} combinations\n`);
    let current = "";
    for (const r of rows) {
      if (r.context !== current) {
        current = r.context;
        console.log(`  [data-context="${current}"]  ground ${r.ground}`);
      }
      if (quiet && r.ok !== false) continue;
      const ratio = r.ratio === null ? "  n/a " : r.ratio.toFixed(2).padStart(6);
      const mark = r.ok === null ? "?" : r.ok ? "ok" : "FAIL";
      const note = r.note ? `  (${r.note})` : "";
      console.log(`    ${r.role.padEnd(20)} ${String(r.fg).padEnd(9)} ${ratio}:1  ${mark}${note}`);
    }
  }
  return failures;
}

/* ── page lint ───────────────────────────────────────────────────────────── */

/* readme.md「發布管道（廣告／非廣告）」. Each array mirrors one labelled line in that section
   word for word; tools/check.test.mjs fails if the two drift apart.

   Legal-core words describe exactly what the association's legal standing denies — a stake,
   a wager, chips turning into cash — so they fail on every channel. Promotional words fail on
   every channel because they break the announcement register. The two ad-only lists fail on
   paid ads (and on undeclared pieces, which are checked as ads) and are only advisory on
   organic posts. */
const LEGAL_CORE_WORDS = [
  "賭博", "博弈", "賭場", "賭", "下注", "投注", "押注", "贏錢", "賺錢", "投資報酬", "穩賺",
  "必勝", "穩贏", "保證贏", "以小博大", "一夜致富", "快速賺錢", "暴富", "現金下注", "彩金",
  "獎金入袋", "送錢", "免費送現金", "抽水", "檯費", "快來撈一筆", "現金獎勵", "轉盤贏現金",
  "免費籌碼"
];
const PROMO_WORDS = ["機會難得", "限時優惠", "驚喜好禮"];
const AD_REVIEW_WORDS = [
  "Jackpot", "JP", "獎池", "Prize Pool", "KO賞金", "賞金獵人", "神秘賞金", "Lucky Draw",
  "幸運抽獎", "爆擊", "翻倍獎金"
];
const AD_TONE_WORDS = ["刺激"];

const CHANNELS = new Set(["ad", "organic", "internal"]);

/* Latin terms match as whole words, so "JP" does not fire inside "JPEG"; Chinese terms have
   no word boundaries and match as substrings. */
function findTerm(haystack, term) {
  if (!/^[\x20-\x7E]+$/.test(term)) return haystack.indexOf(term);
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`(?<![A-Za-z])${escaped}(?![A-Za-z])`, "i").exec(haystack);
  return m ? m.index : -1;
}

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{1F000}-\u{1F0FF}]/u;

function textOf(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ");
}

/* What counts as markup for the hex and token rules. Comments and ordinary text nodes are
   masked to spaces — same length, newlines kept, so reported line numbers stay right.

   A swatch caption reading "#0D4C87" is the card doing its job, not a colour bypassing the
   token layer, and flagging it teaches people to ignore the checker. <style> and <script>
   survive the masking, because a hex in CSS is exactly what rule 1 exists to catch, and so
   do attributes — style="background:#0D4C87" is still a violation. */
function markupOnly(src) {
  const mask = (s) => s.replace(/[^\n]/g, " ");
  const maskTextNodes = (s) => s.replace(/>([^<]*)/g, (_, t) => ">" + mask(t));
  const commentsMasked = src.replace(/<!--[\s\S]*?-->/g, mask);

  let out = "";
  let last = 0;
  const blocks = /<(style|script)\b[\s\S]*?<\/\1>/gi;
  let m;
  while ((m = blocks.exec(commentsMasked))) {
    out += maskTextNodes(commentsMasked.slice(last, m.index)) + m[0];
    last = m.index + m[0].length;
  }
  return out + maskTextNodes(commentsMasked.slice(last));
}

/* A file that documents a rule has to be able to break it. voice.card.html exists to print
   the never-use list, so the lexicon rule fires on every word it is there to show.

   The opt-out is deliberately narrow and noisy: the file must name the exact rule kinds it
   suppresses, in a comment at the top, and the suppression is reported. It is for cards that
   quote a rule, never for artwork that would rather not comply — an escape hatch nobody can
   see is one that gets used to hide real problems. */
function allowed(src) {
  /* Trailing prose after the rule list is allowed — a waiver should say why it exists. */
  const m = /<!--\s*@check-allow\s+([a-z-]+(?:\s*,\s*[a-z-]+)*)[^>]*-->/i.exec(src);
  return new Set(m ? m[1].split(",").map((s) => s.trim()) : []);
}

function lintFile(path, { base, contexts }) {
  const src = readFileSync(path, "utf8");
  const body = markupOnly(src);
  const waived = allowed(src);
  const problems = [];

  const lineOf = (index) => src.slice(0, index).split("\n").length;

  /* 1. raw hex */
  const hexRe = /#[0-9a-fA-F]{3,8}\b/g;
  let m;
  while ((m = hexRe.exec(body))) {
    problems.push({ line: lineOf(m.index), kind: "raw-hex", detail: `${m[0]} — use a token from tokens/colors.css` });
  }

  /* 2. undefined tokens */
  const defined = new Set(base.keys());
  for (const ctx of contexts.values()) for (const k of ctx.keys()) defined.add(k);
  const varRe = /var\(\s*(--[A-Za-z0-9-]+)/g;
  const reported = new Set();
  while ((m = varRe.exec(body))) {
    if (!defined.has(m[1]) && !reported.has(m[1])) {
      reported.add(m[1]);
      problems.push({ line: lineOf(m.index), kind: "unknown-token", detail: `${m[1]} is not defined in tokens/*.css` });
    }
  }

  const text = textOf(src);
  const advisory = [];

  /* 3. lexicon red lines, by channel. The channel is declared on the outermost artboard as
     data-channel="ad" or "organic". An undeclared piece is checked as an ad — the strictest
     reading — so forgetting the attribute can never loosen the rules, and every existing
     template keeps the result it had before channels existed. */
  const declared = /data-channel\s*=\s*"([^"]*)"/.exec(body);
  const channel = declared ? declared[1] : "ad";
  if (declared && !CHANNELS.has(channel)) {
    problems.push({ line: lineOf(declared.index), kind: "channel", detail: `data-channel="${channel}" — use "ad", "organic" or "internal"` });
  }
  /* Internal training material (dealer courses, rules Q&A) teaches the game in its own terms —
     下注 is how the rules say "bet" — so the lexicon does not apply. It must never be
     published, which is what the advisory says. */
  const lexicon = channel !== "internal";
  if (!lexicon) advisory.push({ kind: "internal", detail: "internal training material — lexicon not checked; never publish it externally" });
  const hit = (word) => {
    if (findTerm(text, word) === -1) return null;
    const srcAt = findTerm(src, word);
    return lineOf(srcAt === -1 ? 0 : srcAt);
  };
  for (const word of lexicon ? [...LEGAL_CORE_WORDS, ...PROMO_WORDS] : []) {
    const line = hit(word);
    if (line !== null) problems.push({ line, kind: "red-line-word", detail: `"${word}" is banned on every channel (readme.md 發布管道)` });
  }
  for (const word of lexicon ? [...AD_REVIEW_WORDS, ...AD_TONE_WORDS] : []) {
    const line = hit(word);
    if (line === null) continue;
    if (channel === "organic") {
      const note = AD_TONE_WORDS.includes(word)
        ? "allowed on organic only to describe play, never to promote"
        : "allowed on organic, but never in the same sentence as an amount";
      advisory.push({ kind: "ad-only-word", detail: `"${word}" — ${note}; boosting this post makes it an ad` });
    } else {
      problems.push({ line, kind: "red-line-word", detail: `"${word}" is banned on paid ads${declared ? "" : " (no data-channel, checked as ad)"} (readme.md 發布管道)` });
    }
  }

  /* 4. emoji */
  if (EMOJI.test(text)) {
    problems.push({ line: 0, kind: "emoji", detail: "No emoji, ever — status is a word in a square chip" });
  }

  /* 5. ZIPA casing, in visible text only. File paths are legitimately lowercase, and so are
     social handles — zipa.poker_neihu is the account's actual name, not a misspelling of the
     brand, so stripping handles first keeps the rule from crying wolf on every footer. */
  const casing = /\bZipa\b|\bzipa poker\b/i.exec(
    text.replace(/ZIPA/g, "").replace(/@?\bzipa(?=[._-])[.\w-]*/gi, "")
  );
  if (casing && /Zipa|zipa/.test(casing[0])) {
    problems.push({ line: 0, kind: "casing", detail: `"${casing[0].trim()}" — ZIPA is always all-caps` });
  }

  /* 6. advisory: two separate fixed lines, and a piece may need either, both or neither.
     They are advisory rather than violations because whether a piece carries event
     information is a judgement the file cannot make — and the four older social 1x1 pieces
     were exempted by decision on 2026-08-23 rather than reflowed.

     readme.md 發布管道 (2026-09-28): both lines are required on every paid ad, and on every
     organic piece that carries event information — date, registration or ranking rewards.
     Pure knowledge, behind-the-scenes and recruiting posts need neither. D07's wording was
     revised 2026-08-31 and replaced the shorter workshop line ("本活動限年滿18歲者參與，
     請理性參賽。"). Both lines are matched verbatim, spacing included — nobody may reword
     either one, so an exact match is the whole point of the rule. */
  const LEGAL = "本會賽事為限時限額錦標賽，經最高法院審核認定為非射倖性之撲克競技運動。";
  const AGE = "本活動限年滿 18 歲者參與；請理性參與、量力而為，並遵守相關法令規範。";
  const need = channel === "organic" ? "required on organic pieces that carry event information" : "required on every paid ad";
  if (lexicon && !text.includes(LEGAL)) advisory.push({ kind: "legal-line", detail: `competition-standing line absent — ${need}` });
  if (lexicon && !text.includes(AGE)) advisory.push({ kind: "age-line", detail: `D07 18+ line absent — ${need}` });

  const kept = problems.filter((p) => !waived.has(p.kind));
  const suppressed = problems.length - kept.length;
  if (suppressed) advisory.push({ kind: "check-allow", detail: `${suppressed} finding(s) waived by @check-allow: ${[...waived].join(", ")}` });
  return { problems: kept, advisory };
}

/* ── main ────────────────────────────────────────────────────────────────── */

const args = process.argv.slice(2);
const quiet = args.includes("--quiet");
const files = args.filter((a) => !a.startsWith("--"));
const tokens = parseTokens();

console.log(`ZIPA POKER adherence check — ${tokens.base.size} base tokens, ${tokens.contexts.size} contexts`);

let failures = contrastMatrix(tokens, quiet);

for (const file of files) {
  if (!existsSync(file)) {
    console.log(`\n${file}\n  cannot read file`);
    failures++;
    continue;
  }
  const { problems, advisory } = lintFile(file, tokens);
  console.log(`\n${basename(file)}`);
  if (!problems.length) console.log("  no violations");
  for (const p of problems) console.log(`  line ${String(p.line).padStart(4)}  ${p.kind.padEnd(15)} ${p.detail}`);
  for (const a of advisory) console.log(`  advisory      ${a.kind.padEnd(15)} ${a.detail}`);
  failures += problems.length;
}

console.log(failures ? `\n${failures} violation(s)\n` : "\nclean\n");
process.exit(failures ? 1 : 0);
