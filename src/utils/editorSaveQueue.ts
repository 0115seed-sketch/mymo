// One write in flight, followed by the latest draft. Retry keeps the last successful
// base value; blur/pagehide must never invent a new base or duplicate a pending write.
export class EditorSaveQueue {
  private saved: string
  private desired: string | undefined
  private running: Promise<void> | undefined
  private readonly write: (value: string, base: string) => void | Promise<void>
  private readonly changed: (dirty: boolean) => void
  constructor(initial: string, write: (value: string, base: string) => void | Promise<void>, changed: (dirty: boolean) => void) {
    this.saved = initial
    this.write = write
    this.changed = changed
  }
  get dirty() { return this.desired !== undefined }
  acceptRemote(value: string) {
    if (this.dirty) return false
    this.saved = value
    return true
  }
  request(value: string) {
    this.desired = value === this.saved && !this.running ? undefined : value
    this.changed(this.dirty)
    return this.flush()
  }
  flush(): Promise<void> {
    if (this.running) return this.running
    if (!this.dirty) return Promise.resolve()
    // Install running before starting write, which can synchronously update reactive state.
    const work = Promise.resolve().then(async () => {
      while (this.desired !== undefined) {
        const value = this.desired
        if (value !== this.saved) await this.write(value, this.saved)
        this.saved = value
        if (this.desired === value) this.desired = undefined
        this.changed(this.dirty)
      }
    })
    const result = work.then(() => { this.running = undefined }, error => {
      this.running = undefined
      this.changed(this.dirty)
      throw error
    })
    this.running = result
    return result
  }
}
