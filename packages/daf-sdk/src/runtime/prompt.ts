import { generateText } from 'ai';
import { getModelProvider } from './providers';

export async function runPrompt(
  model: string,
  content: string,
  timeoutMs = 60_000,
): Promise<string> {
  const result = await generateText({
    model: getModelProvider(model, null),
    messages: [{ role: 'user', content }],
    abortSignal: AbortSignal.timeout(timeoutMs),
  });
  return result.text;
}
