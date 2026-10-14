/** Bound JSON reads only. Mutations, uploads and RPCs retain their original semantics. */
export const createReadFetch = (
  fetcher: typeof fetch,
  origin: string,
  limits = { readMs: 15_000, imageMs: 8_000 },
): typeof fetch => {
  const pendingImages = new Map<string, Promise<Response>>();
  let activeImages = 0;
  const queuedImages: Array<() => void> = [];
  const acquireImageSlot = (signal: AbortSignal): Promise<() => void> => new Promise((resolve, reject) => {
    const cancel = () => {
      const index = queuedImages.indexOf(start);
      if (index >= 0) queuedImages.splice(index, 1);
      signal.removeEventListener('abort', cancel);
      reject(signal.reason);
    };
    const start = () => {
      signal.removeEventListener('abort', cancel);
      if (signal.aborted) { reject(signal.reason); return; }
      activeImages += 1;
      resolve(() => {
        activeImages -= 1;
        queuedImages.shift()?.();
      });
    };
    if (signal.aborted) { reject(signal.reason); return; }
    if (activeImages < 4) start();
    else {
      queuedImages.push(start);
      signal.addEventListener('abort', cancel, { once: true });
    }
  });

  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const imageRead = method === 'POST' && url.pathname.startsWith('/storage/v1/object/sign/');
    const jsonRead = method === 'GET' && (
      (url.pathname.startsWith('/rest/v1/') && !url.pathname.startsWith('/rest/v1/rpc/'))
      || url.pathname === '/auth/v1/user'
    );
    if (url.origin !== origin || (!imageRead && !jsonRead)) return fetcher(input, init);

    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    // No completed-result cache: a later permission recheck always reaches the server.
    const key = imageRead && typeof init?.body === 'string' && !init.signal && !(input instanceof Request)
      ? JSON.stringify([url.href, headers.get('authorization'), headers.get('apikey'), init.body])
      : null;
    const shared = key ? pendingImages.get(key) : undefined;
    if (shared) return (await shared).clone();

    const controller = new AbortController();
    const externalSignal = init?.signal ?? (input instanceof Request ? input.signal : null);
    const abort = () => controller.abort(externalSignal?.reason);
    externalSignal?.addEventListener('abort', abort, { once: true });
    if (externalSignal?.aborted) abort();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        // Supabase retries generic network errors. AbortError ends this read
        // immediately so a timed-out request cannot silently restart its deadline.
        const error = new DOMException('Veri yükleme süresi aşıldı.', 'AbortError');
        controller.abort(error);
        reject(error);
      }, imageRead ? limits.imageMs : limits.readMs);
    });
    const operation = (async () => {
      let release: (() => void) | undefined;
      try {
        // Bound the queue as well as the request. A library of images must not
        // flood Storage or delay an unrelated database read.
        if (imageRead) release = await Promise.race([acquireImageSlot(controller.signal), timeout]);
        return await Promise.race([
          fetcher(input, { ...init, signal: controller.signal }).then(async (response) => {
            await response.clone().arrayBuffer();
            return response;
          }),
          timeout,
        ]);
      } finally {
        release?.();
        clearTimeout(timer);
        externalSignal?.removeEventListener('abort', abort);
        if (key) pendingImages.delete(key);
      }
    })();
    if (key) pendingImages.set(key, operation);
    const response = await operation;
    return key ? response.clone() : response;
  };
};
