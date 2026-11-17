/** HTML volume stops at unity; Web Audio keeps the model's 0–4 gain range. */
export class MediaAudioGain {
  private context: AudioContext | null = null;
  private readonly nodes = new Map<
    HTMLMediaElement,
    { source: MediaElementAudioSourceNode; gain: GainNode }
  >();
  set(
    element: HTMLMediaElement,
    value: number,
    nextValue: number,
    seconds: number,
    force: boolean,
  ) {
    if (typeof AudioContext === 'undefined') {
      element.volume = Math.max(0, Math.min(1, value));
      return;
    }
    this.context ??= new AudioContext();
    let nodes = this.nodes.get(element);
    if (!nodes) {
      const source = this.context.createMediaElementSource(element);
      const gain = this.context.createGain();
      source.connect(gain);
      gain.connect(this.context.destination);
      nodes = { source, gain };
      this.nodes.set(element, nodes);
    }
    element.volume = 1;
    const now = this.context.currentTime;
    nodes.gain.gain.cancelScheduledValues(now);
    nodes.gain.gain.setValueAtTime(Math.max(0, Math.min(4, value)), now);
    if (!force)
      nodes.gain.gain.linearRampToValueAtTime(
        Math.max(0, Math.min(4, nextValue)),
        now + seconds,
      );
    if (this.context.state === 'suspended')
      void this.context.resume().catch(() => undefined);
  }
  remove(element: HTMLMediaElement) {
    const nodes = this.nodes.get(element);
    nodes?.source.disconnect();
    nodes?.gain.disconnect();
    this.nodes.delete(element);
  }
  dispose() {
    for (const element of this.nodes.keys()) this.remove(element);
    void this.context?.close().catch(() => undefined);
    this.context = null;
  }
}
