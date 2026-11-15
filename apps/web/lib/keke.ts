import type { KekeAbout } from './api'

/** The pages Keke answers from, by the names their own headings and links use. */
export const PAGE_NAMES: Record<string, string> = {
  '/about': 'About HeyNaija',
  '/about/discover': 'How Discover works',
  '/about/highlights': 'How weekly highlights work',
  '/about/keke': 'Keke, the help bot (this page)',
  '/rules': 'Rules',
  '/privacy': 'Privacy policy',
  '/terms': 'Terms of use',
  '/charter': 'Founding charter',
  '/child-safety': 'Child safety standards',
  '/governance': 'Governance',
  '/progress': 'Progress (the product roadmap)',
}

/**
 * Who a question to Keke goes to, for one model as this server is set up
 * (ADR 0030): Anthropic directly, or OpenRouter and a host it picks. Only hosts
 * that say they neither store nor train on what is sent are allowed.
 */
export function kekeRoute(model: KekeAbout['models'][number]): string {
  if (model.via === 'anthropic') return 'goes to Anthropic directly.'
  if (model.family === 'haiku') {
    return 'goes through OpenRouter, which passes it to Anthropic or to a cloud company that runs Anthropic’s models (Amazon, Google or Microsoft), choosing only one that says it does not store or train on what is sent.'
  }
  return 'goes through OpenRouter to one of the companies that run this openly published model, choosing only one that says it does not store or train on what is sent.'
}
