export function showToast(
  message: string,
  type: 'info' | 'success' | 'warning' | 'error' = 'info',
  duration = 3000
): void {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  const typeStyles = {
    info: 'bg-neutral-900/95 border-amber-600/40 text-amber-300',
    success: 'bg-emerald-950/90 border-emerald-700/60 text-emerald-300',
    warning: 'bg-amber-950/90 border-amber-700/60 text-amber-300',
    error: 'bg-rose-950/95 border-rose-800 text-rose-200'
  };

  toast.className = `flex items-center gap-2 px-4 py-2.5 rounded-xl border text-xs font-mono shadow-2xl backdrop-blur-md transition-all duration-300 transform translate-y-2 opacity-0 ${typeStyles[type]}`;
  toast.innerText = message;

  container.appendChild(toast);

  // Trigger enter animation
  requestAnimationFrame(() => {
    toast.classList.remove('translate-y-2', 'opacity-0');
  });

  setTimeout(() => {
    toast.classList.add('opacity-0', 'translate-y-2');
    setTimeout(() => {
      toast.remove();
    }, 300);
  }, duration);
}
