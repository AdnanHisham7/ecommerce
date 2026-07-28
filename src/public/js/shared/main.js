// ========= Service Worker / Push Notifications =========
// Only register SW (and allow install prompt) when pushNotifications flag is ON
const _flags = window.__FEATURE_FLAGS__ || {};

if (_flags.pushNotifications !== false && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/pwa/sw.js', { scope: '/pwa/' })
      .then((reg) => console.log('SW registered:', reg.scope))
      .catch((err) => console.error('SW error:', err));
  });
}

// ========= PWA Install Prompt =========
let deferredPrompt;
if (_flags.pushNotifications !== false) {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    // Show install banner after 30 seconds
    setTimeout(() => showInstallBanner(), 30000);
  });
}

function showInstallBanner() {
  if (!deferredPrompt) return;
  const banner = document.createElement('div');
  banner.id = 'installBanner';
  banner.className = 'fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-80 bg-primary dark:bg-gray-900 border border-accent-500/30 rounded-2xl p-4 shadow-2xl custom-z animate-slide-in-up flex items-center gap-3';
  banner.innerHTML = `
    <div class="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 overflow-hidden">
      <img
        src="/images/logo.svg"
        alt="AD21Store Logo"
        class="w-full h-full object-contain"
      />
    </div>
    <div class="flex-1 min-w-0">
      <p class="font-bold text-white text-sm">Install AD21Store</p>
      <p class="text-xs text-gray-400">Add to home screen for faster access</p>
    </div>
    <div class="flex gap-2 flex-shrink-0">
      <button onclick="installApp()" class="bg-accent-500 text-primary px-3 py-1.5 rounded-lg text-xs font-bold">Install</button>
      <button onclick="document.getElementById('installBanner').remove()" class="text-gray-400 hover:text-gray-200 p-1"><i class="fa-solid fa-xmark text-sm"></i></button>
    </div>
  `;
  document.body.appendChild(banner);
}

async function installApp() {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  deferredPrompt = null;
  document.getElementById('installBanner')?.remove();
}

// ========= Intersection Observer for animations =========
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('animate-slide-in-up');
      observer.unobserve(entry.target);
    }
  });
}, { threshold: 0.1, rootMargin: '0px 0px -50px 0px' });

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.animate-on-scroll').forEach(el => observer.observe(el));
});

// ========= Scroll to top button =========
const scrollBtn = document.createElement('button');
scrollBtn.className = 'fixed bottom-18 right-3 w-10 h-10 bg-accent-500 text-primary rounded-full shadow-xl flex items-center justify-center opacity-0 pointer-events-none transition-all duration-300 z-40 hover:scale-110 hover:shadow-accent-500/40';
scrollBtn.innerHTML = '<i class="fa-solid fa-chevron-up"></i>';
scrollBtn.onclick = () => window.scrollTo({ top: 0, behavior: 'smooth' });
document.body.appendChild(scrollBtn);

window.addEventListener('scroll', () => {
  const show = window.scrollY > 400;
  scrollBtn.style.opacity = show ? '1' : '0';
  scrollBtn.style.pointerEvents = show ? 'auto' : 'none';
});
