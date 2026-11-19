import type { ContentPart, Message, ModelCapabilities, ModelDefinition } from '@/types/chat';

export function trimBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

export function extractTextFromParts(parts: ContentPart[]): string {
  return parts
    .filter((p): p is Extract<ContentPart, { type: 'text' }> => p.type === 'text')
    .map((p) => p.text)
    .join('\n')
    .trim();
}

export function sliceContextMessages(messages: Message[], maxMessages: number): Message[] {
  const usable = messages.filter((m) => m.role === 'user' || m.role === 'assistant');
  if (maxMessages <= 0 || usable.length <= maxMessages) return usable;
  return usable.slice(-maxMessages);
}

export function inferModelCapabilities(modelId: string): ModelCapabilities {
  const id = modelId.toLowerCase();
  const isImageGen =
    id.includes('dall-e') ||
    id.includes('gpt-image') ||
    id.includes('imagen') ||
    id.includes('flux') ||
    id.includes('sdxl');
  const isAudio = id.includes('whisper') || id.includes('tts') || id.includes('transcribe');
  const isReasoning =
    /^o[134](-|$)/.test(id) ||
    id.includes('gpt-5') ||
    id.includes('reasoner') ||
    id.includes('deepseek-r1') ||
    id.includes('qwq') ||
    id.includes('thinking') ||
    id.includes('gemini-2.5') ||
    id.includes('gemini-3') ||
    id.includes('claude-3-7') ||
    id.includes('claude-sonnet-4') ||
    id.includes('claude-opus-4');
  const isVision =
    !isImageGen &&
    !isAudio &&
    (id.includes('gpt-4') ||
      id.includes('gpt-5') ||
      id.includes('o3') ||
      id.includes('o4') ||
      id.includes('gemini') ||
      id.includes('claude-3') ||
      id.includes('claude-sonnet-4') ||
      id.includes('claude-opus-4') ||
      id.includes('vision') ||
      id.includes('vl'));

  return {
    chat: !isImageGen && !isAudio,
    reasoning: isReasoning,
    vision: isVision,
    imageGen: isImageGen,
    speechIn: id.includes('whisper') || id.includes('transcribe') || id.includes('gemini'),
    speechOut: id.includes('tts'),
  };
}

export function toModelDefinition(id: string, displayName?: string): ModelDefinition {
  return {
    id,
    name: displayName || id,
    capabilities: inferModelCapabilities(id),
  };
}

export function isModelReasoningCapable(
  modelId: string,
  models: ModelDefinition[]
): boolean {
  const found = models.find((m) => m.id === modelId);
  if (found && found.capabilities.reasoning !== undefined) {
    return found.capabilities.reasoning;
  }
  return Boolean(inferModelCapabilities(modelId).reasoning);
}

export function extractDataUrlParts(dataUrl: string): { mimeType: string; base64: string } | null {
  const match = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl);
  if (!match) return null;
  return { mimeType: match[1], base64: match[2] };
}
