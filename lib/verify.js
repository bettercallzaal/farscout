import { parseJson } from './util.js';

// Self-eval / confidence (#2): before delivery, check each finding against the
// sources it was built from. The model labels every finding entailed (sources
// support it), contradicted (sources disagree), or unsupported (sources are
// silent). We drop contradicted findings and tag the rest with a confidence
// marker. Free, one extra light call. Never throws - on any failure the findings
// pass through unchanged (fail-open, since they already cleared cite-or-drop).

const LABEL = { entailed: 'high', unsupported: 'low' };

export async function verifyFindings({ brain, findings, sourceBlock }) {
  if (!findings.length) return findings;
  const numbered = findings.map((f, i) => `[${i + 1}] ${f}`).join('\n');
  let raw;
  try {
    raw = await brain.ask(
      `You are a fact-checker. For each FINDING, decide whether the SOURCES support it.
Label each: "entailed" (a source clearly supports it), "contradicted" (a source disagrees), or "unsupported" (sources are silent / too thin).
Be strict - if the finding overreaches beyond the sources, that is "unsupported".

Output ONLY one compact JSON object, nothing after the closing brace:
{"verdicts":[{"i":1,"label":"entailed"}]}

FINDINGS:
${numbered}

SOURCES:
${sourceBlock}`,
      { tier: 'light' },
    );
  } catch {
    return findings; // fail-open
  }
  const verdicts = parseJson(raw, { verdicts: [] }).verdicts;
  if (!Array.isArray(verdicts) || !verdicts.length) return findings;

  const byIndex = new Map();
  for (const v of verdicts) {
    const i = Number(v?.i);
    if (Number.isInteger(i)) byIndex.set(i, String(v?.label || '').toLowerCase());
  }

  const out = [];
  findings.forEach((f, idx) => {
    const label = byIndex.get(idx + 1);
    if (label === 'contradicted') return; // drop - sources actively disagree
    // tag low-confidence; leave high-confidence clean to keep delivery readable
    const tag = LABEL[label];
    out.push(tag === 'low' ? `[unverified] ${f}` : f);
  });
  // We honor well-formed verdicts even if that drops everything (sources really
  // did contradict it). The malformed/empty-verdicts glitch is already handled
  // above (returns findings unchanged), so reaching here means the labels are real.
  return out;
}
