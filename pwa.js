// Installation metadata uses relative URLs so GitHub Pages subpaths also work.
// No patient content, API replies, or authenticated pages are cached by this worker.
if ('serviceWorker' in navigator && window.isSecureContext) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./service-worker.js', {scope:'./'}).catch(err => console.warn('CPR NOTE 安裝服務未啟用', err));
    });
}
