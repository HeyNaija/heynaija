import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { grantModerator } from '../lib/cli.ts'
import { newMember } from '../lib/members.ts'

// Trivia (docs/adr/0028, phase 7): a site moderator writes a round and runs it from
// the console; a member plays it as it happens. Each question opens 3 seconds after
// the host opens it and stays open for the round's seconds (10 here, the least).

test('a moderator hosts a live Trivia round; a member answers, sees each answer and the results', async ({ browser }) => {
  test.setTimeout(150_000)
  const host = await newMember(browser, 'trivia_host')
  grantModerator(host.handle)
  const player = await newMember(browser, 'trivia_ada')

  // Only hosts write rounds: to anyone else the page does not exist.
  await player.page.goto('/games/trivia')
  await expect(player.page.getByRole('link', { name: 'Host a round' })).toHaveCount(0)
  await player.page.goto('/games/trivia/host')
  await expect(player.page.getByRole('heading', { name: 'Nothing here' })).toBeVisible()

  const title = `E2E Trivia ${Date.now().toString(36)}`
  const p = host.page
  await p.goto('/games/trivia')
  await p.getByRole('link', { name: 'Host a round' }).click()
  await p.waitForURL((url) => url.pathname === '/games/trivia/host')
  await p.getByLabel('Title').fill(title)
  await p.getByLabel('Seconds a question').fill('10')
  await p.getByRole('textbox', { name: 'Question 1' }).fill('Who first writes a name in the Death Note?')
  await p.getByRole('textbox', { name: 'Choice 1', exact: true }).fill('Light Yagami')
  await p.getByRole('textbox', { name: 'Choice 2', exact: true }).fill('Ryuk')
  await p.getByRole('button', { name: 'Add a typed question' }).click()
  await p.getByRole('textbox', { name: 'Question 2' }).fill('Name the anime with the Survey Corps.')
  await p.getByRole('textbox', { name: /Accepted answers/ }).fill('Attack on Titan\nShingeki no Kyojin')
  await p.getByRole('button', { name: 'Save draft' }).click()
  await p.waitForURL(/\/games\/trivia\/rounds\/[0-9a-f-]{36}\/host$/)
  const round = p.url().replace(/\/host$/, '')
  await expect(p.getByRole('heading', { name: 'Draft' })).toBeVisible()
  await p.getByRole('button', { name: 'Put it on the schedule' }).click()
  await expect(p.getByRole('heading', { name: 'Coming up' })).toBeVisible()

  // The member finds it on the Trivia page and waits on it.
  const q = player.page
  await q.goto('/games/trivia')
  await q.getByRole('link', { name: title }).click()
  await q.waitForURL(round)
  await expect(q.getByText(/^Starts /)).toBeVisible()

  // Question 1: the text appears only once it opens; the choice can be changed until time is up, and the last one counts.
  await p.getByRole('button', { name: 'Start: open question 1' }).click()
  await expect(q.getByText('Who first writes a name in the Death Note?', { exact: true })).toBeVisible({ timeout: 20_000 })
  await q.getByRole('button', { name: 'Ryuk' }).click()
  await expect(q.getByText(/^Answered in \d+\.\d\d s\. You can change it until time is up/)).toBeVisible()
  await q.getByRole('button', { name: 'Light Yagami' }).click()
  await expect(q.getByRole('button', { name: 'Light Yagami' })).toHaveAttribute('aria-pressed', 'true')
  await expect(q.getByRole('button', { name: 'Ryuk' })).toHaveAttribute('aria-pressed', 'false')
  await expect(q.getByRole('button', { name: 'Ryuk' })).toBeEnabled()
  // When time is up: right, and first.
  await expect(q.getByText('Right, and 1st: +15 points')).toBeVisible({ timeout: 25_000 })

  // Question 2, typed: capitals do not matter.
  await p.getByRole('button', { name: 'Open question 2' }).click()
  const answer = q.getByRole('textbox', { name: 'Your answer' })
  await expect(answer).toBeVisible({ timeout: 20_000 })
  await answer.fill('attack on titan')
  await answer.press('Enter')
  // A typed answer is final: the field goes.
  await expect(q.getByText(/^Answered in .* You see whether it was right when time is up\./)).toBeVisible()
  await expect(answer).toBeHidden()
  await expect(q.getByText('Right, and 1st: +15 points')).toBeVisible({ timeout: 25_000 })
  await expect(q.getByText(/^That was the last question/)).toBeVisible()

  // The host publishes; the member's page shows the results and The Arbiter's post.
  await p.getByRole('button', { name: 'Publish the results' }).click()
  await p.getByRole('button', { name: 'Yes, publish the results' }).click()
  await expect(q.getByText('The results are out. You came 1st with 30 points.')).toBeVisible({ timeout: 20_000 })
  await expect(q.getByRole('link', { name: 'The Arbiter’s post' })).toBeVisible({ timeout: 15_000 })

  // The points are on the Trivia board, and the round under recent results with the place.
  await q.goto('/games/trivia?tab=leaderboard')
  await expect(q.getByRole('heading', { name: /^Trivia · / })).toBeVisible()
  await expect(q.getByRole('listitem').filter({ hasText: '(you)' })).toContainText('30 points')
  await q.goto('/games/trivia')
  await expect(q.getByRole('region', { name: 'Recent results' }).getByText('You came 1st')).toBeVisible()

  await host.context.close()
  await player.context.close()
})

test('a moderator imports questions from a file, and downloads a saved round’s questions again', async ({ browser }) => {
  const host = await newMember(browser, 'trivia_import')
  grantModerator(host.handle)
  const p = host.page
  await p.goto('/games/trivia/host')
  // The button waits for the page to be ready; a file chosen before then goes nowhere.
  await expect(p.getByRole('button', { name: 'Choose a file' })).toBeEnabled()
  const pick = (name: string, data: unknown) =>
    p.getByLabel('Questions file').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) })

  // A file with a mistake is not imported, and the mistake is named.
  await pick('broken.json', { questions: [{ question: 'Q', choices: ['A', 'B'], answer: 'C' }] })
  await expect(p.getByText('Question 1’s answer "C" is not one of its choices.')).toBeVisible()
  await expect(p.getByRole('textbox', { name: 'Question 1' })).toHaveValue('')

  const title = `E2E Import ${Date.now().toString(36)}`
  const questions = [
    { question: 'Which city is Burna Boy from?', choices: ['Lagos', 'Port Harcourt', 'Abuja'], answer: 'Port Harcourt', note: 'He was born there.' },
    { question: 'Name the anime with the Survey Corps.', answers: ['Attack on Titan', 'Shingeki no Kyojin'] },
  ]
  await pick('music.json', { title, questions })
  await expect(p.getByText('Added 2 questions from music.json. Check them, then save.')).toBeVisible()
  // The empty question the form started with made way, and the empty Title box took the file's title.
  await expect(p.getByLabel('Title')).toHaveValue(title)
  await expect(p.getByRole('textbox', { name: 'Question 1' })).toHaveValue('Which city is Burna Boy from?')
  await expect(p.getByRole('textbox', { name: 'Choice 2', exact: true })).toHaveValue('Port Harcourt')
  await expect(p.getByRole('radio', { name: 'Choice 2 is right' })).toBeChecked()
  await expect(p.getByRole('textbox', { name: 'Question 2' })).toHaveValue('Name the anime with the Survey Corps.')
  await expect(p.getByRole('textbox', { name: /Accepted answers/ })).toHaveValue('Attack on Titan\nShingeki no Kyojin')
  await expect(p.getByRole('textbox', { name: 'Question 3' })).toHaveCount(0)
  await p.getByRole('button', { name: 'Save draft' }).click()
  await p.waitForURL(/\/games\/trivia\/rounds\/[0-9a-f-]{36}\/host$/)

  // The console hands back the saved questions as a file that imports again.
  const [download] = await Promise.all([p.waitForEvent('download'), p.getByRole('button', { name: 'Download questions' }).click()])
  expect(download.suggestedFilename()).toBe(`${title.toLowerCase().replace(/ /g, '-')}.json`)
  const data = JSON.parse(await readFile((await download.path())!, 'utf8'))
  expect(data).toEqual({ format: 'heynaija-trivia', version: 1, title, questions })
  await expect(p.getByText(/^Downloaded e2e-import-.*\.json\. Import it from the form/)).toBeVisible()

  await host.context.close()
})
