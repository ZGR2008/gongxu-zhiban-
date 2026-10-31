/** A generation, rather than only the project ID, also isolates A -> B -> A. */
export class RequestScope {
  private generation = 0;
  private controller: AbortController | undefined;
  begin(owner: string) {
    this.cancel();
    const controller = new AbortController();
    this.controller = controller;
    return { owner, generation: this.generation, signal: controller.signal };
  }
  accepts(ticket: { owner: string; generation: number; signal: AbortSignal }, owner: string | undefined) {
    return !ticket.signal.aborted && ticket.generation === this.generation && ticket.owner === owner;
  }
  cancel() { this.generation++; this.controller?.abort(); this.controller = undefined; }
}
