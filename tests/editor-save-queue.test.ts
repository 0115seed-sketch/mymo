import { describe, expect, it } from 'vitest'
import { EditorSaveQueue } from '../src/utils/editorSaveQueue'

function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r }); return { promise, resolve } }

describe('editor saves', () => {
  it('does not save again when blur, visibilitychange and pagehide flush an in-flight input', async () => {
    const gate = deferred(), writes: string[][] = []
    const queue = new EditorSaveQueue('old', async (value, base) => { writes.push([value, base]); await gate.promise }, () => {})
    const saving = queue.request('new')
    await Promise.resolve()
    expect(queue.flush()).toBe(saving)
    expect(queue.flush()).toBe(saving)
    gate.resolve(); await saving
    expect(writes).toEqual([['new', 'old']])
    expect(queue.dirty).toBe(false)
  })
  it('coalesces rapid typing and advances its base only after a successful write', async () => {
    const gate = deferred(), writes: string[][] = []
    const queue = new EditorSaveQueue('a', async (value, base) => { writes.push([value, base]); if (writes.length === 1) await gate.promise }, () => {})
    const saving = queue.request('ab'); await Promise.resolve()
    queue.request('abc'); queue.request('abcd')
    gate.resolve(); await saving
    expect(writes).toEqual([['ab', 'a'], ['abcd', 'ab']])
  })
  it('retries a failed save with the original base, not the failed draft', async () => {
    const writes: string[][] = []; let fails = true
    const queue = new EditorSaveQueue('old', (value, base) => { writes.push([value, base]); if (fails) throw new Error('disk full') }, () => {})
    await expect(queue.request('new')).rejects.toThrow('disk full')
    expect(queue.dirty).toBe(true)
    fails = false; await queue.flush()
    expect(writes).toEqual([['new', 'old'], ['new', 'old']])
  })
  it('notifies reactive consumers when a save finishes, so a waiting remote update can be applied', async () => {
    const dirty: boolean[] = [], gate = deferred()
    const queue = new EditorSaveQueue('a', async () => gate.promise, value => { dirty.push(value) })
    const saving = queue.request('b'); expect(queue.acceptRemote('remote')).toBe(false)
    gate.resolve(); await saving
    expect(dirty).toEqual([true, false])
    expect(queue.acceptRemote('remote')).toBe(true)
    await queue.request('next')
    expect(queue.dirty).toBe(false)
  })
  it('does not write merely because a remote value was loaded or focus was lost', async () => {
    let writes = 0
    const queue = new EditorSaveQueue('a', () => { writes++ }, () => {})
    queue.acceptRemote('remote')
    await queue.request('remote'); await queue.flush()
    expect(writes).toBe(0)
  })
})
