import { render } from 'preact';
import { registerSW } from 'virtual:pwa-register';
import { App } from './ui/App';
import { showToast } from './ui/toast';

// Register PWA service worker with auto-update and offline capability
registerSW({
  immediate: true,
  onNeedRefresh() {
    showToast('Yeni bir versiyon mevcut. Sayfa yenileniyor...', 'info', 2000);
  },
  onOfflineReady() {
    showToast('Karanlık Oda çevrimdışı kullanıma hazır!', 'success', 3000);
  }
});

const rootElement = document.getElementById('app');
if (rootElement) {
  render(<App />, rootElement);
}
