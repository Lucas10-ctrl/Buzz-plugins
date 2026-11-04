/** API-v1 entry. The editor UI arrives through the declared launcher, which downloads and verifies it on first use. */
export const inject = ["react", "host", "pages", "agents", "relay", "conversation", "panels", "navigation", "settingsCards"];
export async function apply(ctx) {
  if (typeof ctx.react.useEffectEvent !== "function") throw new Error("Canvas requires a current Buzz build with React 19.2 or newer");
  const windows = typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent);
  let stopped = false;
  let process;
  ctx.effect(() => () => {stopped = true;void process?.kill()});
  let encoded = "";
  let errors = "";
  let failure;
  process = await ctx.host.spawn(windows ? "editor-ui-win" : "editor-ui", {
    onStdout(chunk) {
      if (encoded.length + chunk.length > 32_000_000) {
        failure = new Error("Editor package exceeds its declared UI payload bound");
        void process?.kill();
        return;
      }
      encoded += chunk;
    },
    onStderr(chunk) { errors = (errors + chunk).slice(-2000) },
  });
  if (stopped) {await process.kill();return}
  const code = await process.exited;
  if (stopped) return;
  if (failure) throw failure;
  if (code !== 0) throw new Error(`Canvas could not start${errors.trim() ? `: ${errors.trim()}` : ""}`);
  encoded = encoded.replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 !== 0) throw new Error("Editor UI payload is not valid base64");
  const raw = atob(encoded), bytes = Uint8Array.from(raw, letter => letter.charCodeAt(0));
  encoded = "";
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  const reader = stream.getReader(), chunks = [];
  let length = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      length += result.value.byteLength;
      if (length > 64_000_000) throw new Error("Editor UI expands beyond its package bound");
      chunks.push(result.value);
    }
  } finally {await reader.cancel()}
  if (stopped) return;
  const url = URL.createObjectURL(new Blob(chunks, {type:"text/javascript"}));
  try {
    const editor = await import(/* @vite-ignore */ url);
    if (!stopped) await editor.apply(ctx);
  } finally {URL.revokeObjectURL(url)}
}
