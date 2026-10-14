/** A short, locally generated chime; no media download or additional dependency. */
export const createNotificationSound = () => {
  let context: AudioContext | null = null;
  let disposed = false;

  const unlock = async (): Promise<boolean> => {
    if (disposed || typeof AudioContext === 'undefined') return false;
    context ??= new AudioContext();
    if (context.state === 'suspended') await context.resume();
    return !disposed && context.state === 'running';
  };

  const play = (): boolean => {
    if (disposed || context?.state !== 'running') return false;
    const start = context.currentTime;
    [660, 880].forEach((frequency, index) => {
      const oscillator = context!.createOscillator();
      const gain = context!.createGain();
      const time = start + index * 0.12;
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, time);
      gain.gain.linearRampToValueAtTime(0.07, time + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.18);
      oscillator.connect(gain);
      gain.connect(context!.destination);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
      oscillator.start(time);
      oscillator.stop(time + 0.2);
    });
    return true;
  };

  return {
    unlock,
    play,
    isReady: () => !disposed && context?.state === 'running',
    dispose: () => {
      disposed = true;
      if (context && context.state !== 'closed') void context.close().catch(() => undefined);
      context = null;
    },
  };
};
