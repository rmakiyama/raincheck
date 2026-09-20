import { describe, expect, it } from 'vitest'
import { DEPTH_LABELS, OUTCOME, QUESTIONS } from '../src/questions.ts'

describe('questions', () => {
  it('has an outcome for every pair of distance and effect levels', () => {
    expect(OUTCOME).toHaveLength(QUESTIONS.distance.criteria.length)
    for (const row of OUTCOME) expect(row).toHaveLength(QUESTIONS.effect.criteria.length)
  })

  it('has a label for every level of depth', () => {
    expect(DEPTH_LABELS).toHaveLength(QUESTIONS.depth.criteria.length)
  })
})
