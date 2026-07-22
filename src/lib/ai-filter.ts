import { z } from 'zod';

import type { Env } from './config';
import { getAppBaseUrl } from './config';
import {
  CLASSIFIER_VERSION,
  getClassificationInput,
  isAdmissibleAiEvidence,
} from './classification';
import type { MatchedConcours } from './scraper';

const AiDecisionSchema = z.object({
  id: z.string().min(1),
  relevant: z.boolean(),
  reason: z.string().trim().min(1).max(500),
  evidence: z.string().trim().max(300),
}).strict();

const AiPayloadSchema = z.object({
  results: z.array(AiDecisionSchema),
}).strict();

const FileAnnotationSchema = z.object({
  type: z.literal('file'),
  file: z.object({
    hash: z.string(),
    name: z.string().optional(),
    content: z.array(z.object({
      type: z.string(),
      text: z.string().optional(),
    }).passthrough()),
  }).passthrough(),
}).passthrough();

const OpenRouterResponseSchema = z.object({
  model: z.string().optional(),
  choices: z.array(z.object({
    message: z.object({
      content: z.string(),
      annotations: z.array(FileAnnotationSchema).optional(),
    }).passthrough(),
  }).passthrough()).min(1),
}).passthrough();

const AI_BATCH_SIZE = 2;

export async function filterWithAI(
  items: MatchedConcours[],
  env: Env
): Promise<MatchedConcours[]> {
  if (!env.OPENROUTER_API_KEY) {
    console.warn(JSON.stringify({ event: 'ai-filter-skipped', reason: 'OPENROUTER_API_KEY not set' }));
    return items;
  }

  if (items.length === 0) return items;

  const classified: MatchedConcours[] = [];
  for (let index = 0; index < items.length; index += AI_BATCH_SIZE) {
    const batch = items.slice(index, index + AI_BATCH_SIZE);
    classified.push(...await filterBatchWithAI(batch, env));
  }
  return classified;
}

async function filterBatchWithAI(items: MatchedConcours[], env: Env): Promise<MatchedConcours[]> {
  const configuredModel = env.OPENROUTER_MODEL || 'openrouter/free';
  const inputs = items.map((item) => ({
    ...getClassificationInput(item),
    officialDocument: item.classificationDocumentDataUrl ? `concours-${item.id}.pdf` : '',
  }));
  // Emploi Public blocks OpenRouter from fetching some document URLs directly.
  // Attach only PDFs that this Worker fetched and validated successfully.
  const documents = items.filter((item) => item.classificationDocumentDataUrl);
  const prompt = `You classify Moroccan public-sector concours for WEB or SOFTWARE DEVELOPMENT eligibility.

Rules:
- Relevant=true only when the supplied text explicitly describes software/web development, programming, software engineering, or application-development work.
- "Toutes les spécialités" is NEVER evidence of development eligibility.
- Generic "informatique", "génie informatique", information systems, networks, cybersecurity, support, BI, or IT management are NOT sufficient.
- Finance, planning, control, administration, healthcare, law, construction, and other non-development jobs are not relevant.
- Do not infer that a broad degree or specialty includes development.
- Official PDF files are named concours-ID.pdf and belong only to the matching concours ID.
- Inspect an attached official PDF when present, including scanned/image-only pages.
- For every relevant=true result, evidence must be an exact quote copied from that concours input or its matching official PDF. If no exact quote exists, return relevant=false and evidence="".

Respond only with this JSON shape:
{"results":[{"id":"...","relevant":true,"reason":"one short sentence","evidence":"exact quote from input"}]}

Classifier version: ${CLASSIFIER_VERSION}
Concours:
${JSON.stringify(inputs, null, 2)}`;

  const messageContent = documents.length === 0
    ? prompt
    : [
        { type: 'text', text: prompt },
        ...documents.map((item) => ({
          type: 'file',
          file: {
            filename: `concours-${item.id}.pdf`,
            file_data: item.classificationDocumentDataUrl,
          },
        })),
      ];

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
        model: configuredModel,
        temperature: 0,
        messages: [{ role: 'user', content: messageContent }],
        ...(documents.length > 0 ? {
          plugins: [{ id: 'file-parser', pdf: { engine: 'cloudflare-ai' } }],
        } : {}),
        response_format: { type: 'json_object' },
      }),
    });

    if (!res.ok) {
      const raw = await res.text();
      console.error(JSON.stringify({
        event: 'ai-filter-http-error',
        status: res.status,
        body: raw.slice(0, 1_200),
        model: configuredModel,
      }));
      return items;
    }

    const response = OpenRouterResponseSchema.safeParse(await res.json());
    if (!response.success) {
      console.error(JSON.stringify({ event: 'ai-filter-response-invalid', issues: response.error.issues }));
      return items;
    }

    const actualModel = response.data.model || configuredModel;
    const documentTextById = new Map<string, string>();
    for (const annotation of response.data.choices[0].message.annotations || []) {
      const name = annotation.file.name || '';
      const id = name.match(/^concours-(.+)\.pdf$/)?.[1];
      if (!id) continue;
      const text = annotation.file.content
        .filter((part) => part.type === 'text' && part.text)
        .map((part) => part.text || '')
        .join(' ');
      documentTextById.set(id, text);
    }
    let decoded: unknown;
    try {
      decoded = JSON.parse(response.data.choices[0].message.content);
    } catch {
      console.error(JSON.stringify({ event: 'ai-filter-json-invalid', model: actualModel }));
      return items;
    }

    const payload = AiPayloadSchema.safeParse(decoded);
    if (!payload.success) {
      console.error(JSON.stringify({ event: 'ai-filter-payload-invalid', issues: payload.error.issues, model: actualModel }));
      return items;
    }

    const requestedIds = new Set(items.map((item) => item.id));
    const decisions = new Map(
      payload.data.results
        .filter((decision) => requestedIds.has(decision.id))
        .map((decision) => [decision.id, decision])
    );

    const classified = items.map((item) => {
      const decision = decisions.get(item.id);
      if (!decision) return item;

      const evidenceAccepted = !decision.relevant || isAdmissibleAiEvidence(
        item,
        decision.evidence,
        documentTextById.get(item.id) || ''
      );
      const relevant = decision.relevant && evidenceAccepted;
      const reason = evidenceAccepted
        ? decision.reason
        : `Garde-fou: preuve AI rejetée (${decision.evidence || 'aucune preuve'}).`;

      console.log(JSON.stringify({
        event: 'classification-decision',
        id: item.id,
        relevant,
        source: 'ai',
        model: actualModel,
        evidence: decision.evidence,
        evidenceAccepted,
        classifierVersion: CLASSIFIER_VERSION,
      }));

      return {
        ...item,
        aiRelevant: relevant,
        aiReason: reason,
        classificationSource: 'ai' as const,
        classificationModel: actualModel,
        classifiedAt: new Date().toISOString(),
      };
    });

    console.log(JSON.stringify({
      event: 'ai-filter-complete',
      requested: items.length,
      returned: decisions.size,
      documents: documents.length,
      documentAnnotations: documentTextById.size,
      model: actualModel,
      classifierVersion: CLASSIFIER_VERSION,
    }));
    return classified;
  } catch (error) {
    console.error(JSON.stringify({
      event: 'ai-filter-fetch-error',
      error: error instanceof Error ? error.message : String(error),
      model: configuredModel,
    }));
    return items;
  }
}
