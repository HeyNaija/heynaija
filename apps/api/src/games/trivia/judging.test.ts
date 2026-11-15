import assert from 'node:assert/strict'
import { test } from 'node:test'
import { choiceOrder, editDistance, matches, normalise, placesOf, pointsFor, roundPlaces, typosAllowed } from './judging.js'

test('a typed answer is read without case, accents, spaces, punctuation or a leading "the"', () => {
  assert.equal(normalise('  Gojō Satoru '), 'gojosatoru')
  assert.equal(normalise('Shingeki-no Kyojin!'), 'shingekinokyojin')
  assert.equal(normalise('The Promised Neverland'), 'promisedneverland')
  assert.equal(normalise('…'), '')
})

test('small typos are forgiven in longer answers only', () => {
  assert.equal(typosAllowed(4), 0)
  assert.equal(typosAllowed(6), 1)
  assert.equal(typosAllowed(12), 2)
  assert.equal(editDistance('naruto', 'nauto'), 1)
  assert.equal(editDistance('naruto', 'nrauto'), 1, 'two letters swapped are one typo')
  assert.ok(matches(normalise('Naurto Uzumaki'), ['Naruto Uzumaki']))
  assert.ok(matches(normalise('uzumaki naruto'), ['Naruto Uzumaki', 'Uzumaki Naruto']))
  assert.ok(!matches(normalise('Ryk'), ['Ryuk']), 'short answers must be exact')
  assert.ok(matches(normalise('Gojou'), ['Gojo', 'Gojou']))
  assert.ok(!matches(normalise('Sasuke'), ['Naruto']))
  assert.ok(!matches('', ['Naruto']))
})

test('each member sees the choices in their own order, the same every time', () => {
  const a = choiceOrder('q1', 'ada', 4)
  assert.deepEqual([...a].sort(), [0, 1, 2, 3])
  assert.deepEqual(choiceOrder('q1', 'ada', 4), a)
  const orders = new Set(['ada', 'bayo', 'chi', 'dayo', 'emeka', 'funmi'].map((m) => choiceOrder('q1', m, 4).join('')))
  assert.ok(orders.size > 1, 'members do not all see the same order')
})

test('the first right answers are placed by time, and an exact tie by the order written', () => {
  const t = (ms: number) => new Date(1_700_000_000_000 + ms)
  const places = placesOf([
    { memberId: 'late', correct: true, answeredAt: t(900), seq: 1 },
    { memberId: 'wrong', correct: false, answeredAt: t(100), seq: 2 },
    { memberId: 'tieB', correct: true, answeredAt: t(300), seq: 5 },
    { memberId: 'tieA', correct: true, answeredAt: t(300), seq: 4 },
  ])
  assert.deepEqual([...places], [['tieA', 1], ['tieB', 2], ['late', 3]])
  assert.equal(pointsFor(true, 1), 15)
  assert.equal(pointsFor(true, 2), 13)
  assert.equal(pointsFor(true, 3), 12)
  assert.equal(pointsFor(true, 4), 10)
  assert.equal(pointsFor(false, null), 0)
})

test('a round is placed by points, then by less time on right answers, then shared', () => {
  const places = roundPlaces([
    { memberId: 'a', points: 30, timeMs: 9000 },
    { memberId: 'b', points: 30, timeMs: 4000 },
    { memberId: 'c', points: 10, timeMs: 1000 },
    { memberId: 'd', points: 10, timeMs: 1000 },
  ])
  assert.deepEqual(Object.fromEntries(places), { b: 1, a: 2, c: 3, d: 3 })
})
