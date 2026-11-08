import { describe, expect, it } from 'vitest'
import { applyTabStatus, markTabsSeen, tabIndicator, type TabStatus } from '@renderer/main-window/tabAttention'

const idle: TabStatus = { sending: false, awaitingUser: false, turnUnseen: false }
const running: TabStatus = { sending: true, awaitingUser: false, turnUnseen: false }
const ended = { sending: false, awaitingUser: false }

describe('applyTabStatus', () => {
  it('marks a turn that ended while the tab was hidden as unseen', () => {
    expect(applyTabStatus(running, ended, false).turnUnseen).toBe(true)
  })

  it('does not mark a turn that ended while the tab was visible', () => {
    expect(applyTabStatus(running, ended, true).turnUnseen).toBe(false)
  })

  it('does not mark a tab that has only just opened', () => {
    expect(applyTabStatus(undefined, ended, false).turnUnseen).toBe(false)
  })

  it('marks the turn when its pending question is cancelled at the same time', () => {
    const awaiting = { ...running, awaitingUser: true }
    expect(applyTabStatus(awaiting, ended, false)).toEqual({ ...idle, turnUnseen: true })
  })

  it('keeps the mark when the question is cancelled after the turn ended', () => {
    const afterTurn = applyTabStatus(
      { ...running, awaitingUser: true },
      { sending: false, awaitingUser: true },
      false
    )
    expect(applyTabStatus(afterTurn, ended, false).turnUnseen).toBe(true)
  })

  it('clears the mark when a new turn starts', () => {
    const unseen = { ...idle, turnUnseen: true }
    expect(applyTabStatus(unseen, { sending: true, awaitingUser: false }, true).turnUnseen).toBe(false)
  })

  it('returns the same object when nothing changed', () => {
    expect(applyTabStatus(running, { sending: true, awaitingUser: false }, false)).toBe(running)
  })
})

describe('markTabsSeen', () => {
  it('clears only the visible tabs', () => {
    const statuses = { a: { ...idle, turnUnseen: true }, b: { ...idle, turnUnseen: true } }
    const next = markTabsSeen(statuses, ['a'])
    expect(next.a?.turnUnseen).toBe(false)
    expect(next.b?.turnUnseen).toBe(true)
  })

  it('returns the same object when nothing changed', () => {
    const statuses = { a: running }
    expect(markTabsSeen(statuses, ['a', 'missing'])).toBe(statuses)
  })
})

describe('tabIndicator', () => {
  it('shows nothing for tabs without a status', () => {
    expect(tabIndicator(undefined, false)).toEqual({ spin: false, blink: false, badge: false })
  })

  it('spins during a turn, in front or not', () => {
    expect(tabIndicator(running, true)).toEqual({ spin: true, blink: false, badge: false })
    expect(tabIndicator(running, false)).toEqual({ spin: true, blink: false, badge: false })
  })

  it('stops spinning while awaiting the user, and alerts only when not in front', () => {
    const awaiting = { ...running, awaitingUser: true }
    expect(tabIndicator(awaiting, true)).toEqual({ spin: false, blink: false, badge: false })
    expect(tabIndicator(awaiting, false)).toEqual({ spin: false, blink: true, badge: true })
  })

  it('blinks without a badge for an unseen turn end', () => {
    expect(tabIndicator({ ...idle, turnUnseen: true }, false)).toEqual({ spin: false, blink: true, badge: false })
  })
})
