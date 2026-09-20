import { describe, expect, it } from 'vitest'
import { QUESTIONS, buildQuestions } from '../src/questions.ts'
import type { RecentWork } from '../src/types.ts'

const project = (name: string) => ({ name, branches: [], sessions: 1, titles: [], prompts: [] })

describe('buildQuestions', () => {
  it('adds one relevant_to question per project, addressed by index, on top of the fixed ones', () => {
    const work: RecentWork = { days: 7, projects: [project('org/app'), project('dev/tool')] }
    const q = buildQuestions(work)
    expect(Object.keys(q)).toEqual([...Object.keys(QUESTIONS), 'relevant_to::org/app', 'relevant_to::dev/tool'])
    expect(q['relevant_to::dev/tool']).toEqual({
      type: 'noul',
      instructions: 'Does `article` bear on the project, technologies, or problems described in `recent_work.projects[1]`?',
      criteria: QUESTIONS.relevant.criteria,
    })
  })

  it('leaves QUESTIONS untouched', () => {
    const before = Object.keys(QUESTIONS)
    buildQuestions({ days: 7, projects: [project('x')] })
    expect(Object.keys(QUESTIONS)).toEqual(before)
  })
})
