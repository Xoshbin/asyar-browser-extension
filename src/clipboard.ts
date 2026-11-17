/**
 * Copies `text` to the clipboard and reports whether it landed.
 *
 * The async Clipboard API is tried first; a sandboxed extension view can be
 * denied `clipboard-write` by the Permissions API, so the legacy
 * `execCommand('copy')` path stays as the fallback. Callers own the feedback
 * copy — this returns a boolean rather than showing a HUD so two actions can
 * share it with their own wording.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    textarea.remove();
    return ok;
  } catch {
    return false;
  }
}
