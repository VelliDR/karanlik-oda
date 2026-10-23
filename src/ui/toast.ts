export function showToast(
  message: string,
  type: 'info' | 'success' | 'warning' | 'error' = 'info',
  duration = 3000
): void {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  const typeStyles = {
    info: 'bg-m3Surface border-m3Border text-m3Red',
    success: 'bg-emerald-950/80 border-emerald-800 text-emerald-300',
    warning: 'bg-amber-950/80 border-amber-800 text-amber-300',
    error: 'bg-red-950/90 border-red-800 text-red-200'
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
