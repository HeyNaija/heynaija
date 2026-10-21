import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { CONSTITUTION_SECTIONS, LEGAL_REFERENCES } from '../apps/web/lib/constitution.ts'
import { CONSTITUTION } from '../apps/web/lib/governance.ts'

const path = fileURLToPath(new URL('../docs/governance/cac-constitution.md', import.meta.url))
const lines = [
  '# HeyNaija nonprofit constitution — CAC review copy', '',
  `**${CONSTITUTION.label} · ${CONSTITUTION.updated}**`, '',
  CONSTITUTION.status, '',
  '> Generated from the same text as /governance/constitution. Edit apps/web/lib/constitution.ts and run pnpm governance:generate. This is a legal-review draft, not a completed filing. Schedule 1 and qualified Nigerian legal approval remain required.', '',
]
for (const section of CONSTITUTION_SECTIONS) {
  lines.push(`## ${section.title}`, '')
  section.clauses.forEach((clause, i) => lines.push(`${i + 1}. ${clause}`, ''))
}
lines.push('## Primary references', '', 'Sources checked 19 October 2026; confirm current law and CAC practice before filing.', '')
for (const source of LEGAL_REFERENCES) lines.push(`- [${source.title}](${source.url})`)
lines.push('', '## Version history', '')
for (const entry of CONSTITUTION.changelog) lines.push(`- **v${entry.version}, ${entry.date}:** ${entry.summary}`)
const output = lines.join('\n') + '\n'
if (process.argv.includes('--check')) {
  if (await readFile(path, 'utf8').catch(() => '') !== output) {
    console.error('CAC review copy differs from the website. Run pnpm governance:generate.')
    process.exitCode = 1
  } else console.log('CAC review copy matches the public constitution.')
} else {
  await writeFile(path, output)
  console.log('Updated docs/governance/cac-constitution.md')
}
