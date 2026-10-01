import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { Locale } from "@/lib/i18n/config";
import { RECOGNITION_SCHEMA, RECOGNITION_SYSTEM, recognitionConfigured, recognitionPrompt, validateRecognition, type Recognition, type RecognitionCandidate } from "./recognition";

/**
 * The reader behind "Ajouter un document": the file goes to the Claude API
 * once, with the records it could belong to, and comes back as a proposal
 * (class, title, key facts, related record) the person confirms. Server
 * only: the key never reaches a browser. Without a key the reader is off
 * and the dialog works as it always did.
 */
export const RECOGNITION_MODEL = process.env.DOCUMENT_RECOGNITION_MODEL || "claude-opus-5-5";

export { recognitionConfigured };

type ImageType = "image/jpeg" | "image/png" | "image/webp";

export async function recogniseDocument(input: { bytes: Uint8Array; mime: string; lang: Locale; candidates: RecognitionCandidate[] }): Promise<Recognition | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  const client = new Anthropic({ apiKey, timeout: 55_000, maxRetries: 1 });
  const data = Buffer.from(input.bytes).toString("base64");
  const file: Anthropic.ContentBlockParam =
    input.mime === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data } }
      : { type: "image", source: { type: "base64", media_type: input.mime as ImageType, data } };
  const response = await client.messages.parse({
    model: RECOGNITION_MODEL,
    max_tokens: 8000,
    system: RECOGNITION_SYSTEM,
    messages: [{ role: "user", content: [file, { type: "text", text: recognitionPrompt(input.lang, input.candidates) }] }],
    output_config: { effort: "medium", format: zodOutputFormat(RECOGNITION_SCHEMA) },
  });
  if (response.stop_reason === "refusal") return null;
  return validateRecognition(
    response.parsed_output,
    input.candidates.map((c) => c.id),
  );
}
