import type { Env } from './config';
import { getAppBaseUrl } from './config';
import type { MatchedConcours } from './scraper';

export async function filterWithAI(
  items: MatchedConcours[],
  env: Env
): Promise<MatchedConcours[]> {
  if (!env.OPENROUTER_API_KEY) {
    console.warn('[ai-filter] OPENROUTER_API_KEY not set. Skipping AI filter.');
    return items;
  }

  if (items.length === 0) return items;

  const prompt = `
You are a classifier for Moroccan public sector job concours.
Your goal is to identify concours where WEB DEVELOPMENT or SOFTWARE DEVELOPMENT (développement informatique / génie logiciel) is one of the target roles.

Mark as RELEVANT (true) if the required specialties explicitly mention:
- "développement informatique" or "développement web"
- "génie logiciel" (software engineering)
Even if these are grouped in a single announcement alongside unrelated specialties (e.g. plumbing, finance, administration), they are still relevant because there are dedicated posts allocated specifically for developers.

Mark as NOT RELEVANT (false) if:
- The role is medical, healthcare, legal, administrative, financial, construction, urban planning, sports, operations, or any non-IT field AND does not explicitly list "développement informatique" or "génie logiciel" as an option.
- It only lists generic "informatique", "reseaux", "gestion informatique" or "sécurité" alongside many non-IT specialties.
- The role is purely about IT management, IT security, or IT support.

Be accurate and objective. Only mark as relevant if a developer would be eligible to apply.

Respond ONLY with a JSON object of the form:
{"results": [ { "id": "...", "relevant": true/false, "reason": "..." }, ... ] }

Each object must have:
- "id": The ID of the concours
- "relevant": boolean
- "reason": A short 1-sentence reason for your decision.

Concours list:
${JSON.stringify(
  items.map((it) => ({
    id: it.id,
    title: it.title,
    organization: it.details?.['Administration qui recrute'] || '',
    specialties: it.details?.['Spécialités requises'] || '',
  })),
  null,
  2
)}
  `;

  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        'HTTP-Referer': getAppBaseUrl(env),
        'X-Title': 'Concours Tracker',
      },
      body: JSON.stringify({
        model: 'openrouter/free',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
      }),
    });

    if (!res.ok) {
      console.error('[ai-filter] API Error:', res.status, await res.text());
      return items; // Fallback to returning all if API fails
    }

    const data = await res.json() as any;
    const content = data.choices?.[0]?.message?.content;
    if (!content) return items;

    // The model returns { "results": [ ... ] } per the prompt + json_object format.
    let parsed: any;
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      console.error('[ai-filter] Failed to parse JSON:', content);
      return items;
    }

    const arr = Array.isArray(parsed) ? parsed : parsed?.results;
    if (!Array.isArray(arr)) {
      console.error('[ai-filter] Expected { results: [...] }, got:', content.slice(0, 200));
      return items;
    }

    const decisions = new Map<string, any>(arr.map((p: any) => [String(p.id), p]));
    console.log(`[ai-filter] AI classified ${decisions.size}/${items.length} items. Model: ${data.model || 'unknown'}`);

    return items.map((it) => {
      const decision = decisions.get(String(it.id));
      if (decision) {
        return {
          ...it,
          aiRelevant: decision.relevant,
          aiReason: decision.reason,
        };
      }
      return it;
    });
  } catch (err) {
    console.error('[ai-filter] Fetch error:', err);
    return items;
  }
}
