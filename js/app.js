import { PhotoEditor } from './editor.js';

let editor;

const fileInput = document.getElementById('file-input');
const btnUpload = document.getElementById('btn-upload');
const btnRotate = document.getElementById('btn-rotate');
const btnReset = document.getElementById('btn-reset');
const btnSave = document.getElementById('btn-save');
const placeholder = document.getElementById('no-image-placeholder');
const canvas = document.getElementById('editor-canvas');

// app.js içindeki slider listesini bu şekilde güncelle:

const sliders = {
    exposure: document.getElementById('slider-exposure'),
    contrast: document.getElementById('slider-contrast'),
    saturation: document.getElementById('slider-saturation'),
    warmth: document.getElementById('slider-warmth'),
    swirl: document.getElementById('slider-swirl'),
    chromatic: document.getElementById('slider-chromatic'), // Yeni
    vignette: document.getElementById('slider-vignette')
};

function initApp() {
    editor = new PhotoEditor(canvas);

    btnUpload.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', handleFileLoad);
    btnRotate.addEventListener('click', () => editor.rotate());
    btnReset.addEventListener('click', handleReset);
    btnSave.addEventListener('click', handleSave);

    Object.keys(sliders).forEach(key => {
        sliders[key].addEventListener('input', (e) => {
            const val = parseInt(e.target.value);
            document.getElementById(`val-${key}`).innerText = val > 0 ? `+${val}` : val;
            
            editor.settings[key] = val;
            editor.render();
        });
    });

    document.querySelectorAll('.btn-preset').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const presetKey = e.target.getAttribute('data-preset');
            
            document.querySelectorAll('.btn-preset').forEach(b => b.className = "btn-preset bg-m3Bg border border-m3Border hover:border-m3Red p-2 rounded-xl text-xs");
            e.target.className = "btn-preset bg-m3RedDark border border-m3Red p-2 rounded-xl text-xs font-bold";

            editor.settings.preset = presetKey;
            editor.render();
        });
    });
}

// ASYNC GÜVENLİ GÖRSEL SEÇİCİ: Yarış durumlarını (Race conditions) engeller
function handleFileLoad(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
            placeholder.classList.add('hidden');
            
            editor.loadImage(img, () => {
                btnRotate.disabled = false;
                btnReset.disabled = false;
                btnSave.disabled = false;
                btnSave.className = "w-full bg-emerald-900 border border-emerald-800 text-emerald-400 py-3 rounded-xl text-xs font-bold tracking-wider transition-colors cursor-pointer";
            });
        };
        img.src = event.target.result;
    };
    reader.readAsDataURL(file);
}

function handleReset() {
    editor.resetSettings();
    
    Object.keys(sliders).forEach(key => {
        sliders[key].value = 0;
        document.getElementById(`val-${key}`).innerText = "0";
    });

    document.querySelectorAll('.btn-preset').forEach(b => b.className = "btn-preset bg-m3Bg border border-m3Border hover:border-m3Red p-2 rounded-xl text-xs");
    document.querySelector('[data-preset="none"]').className = "btn-preset bg-m3RedDark border border-m3Red p-2 rounded-xl text-xs font-bold";

    editor.render();
}

function handleSave() {
    if (!editor.originalImg) return;

    btnSave.innerText = "💾 İŞLENİYOR (16MP+)...";
    btnSave.disabled = true;

    // Arayüzün donmasını engellemek için tarayıcıyı mikro saniye dinlendirip arka planda işliyoruz
    setTimeout(() => {
        const exportCanvas = document.createElement('canvas');
        exportCanvas.width = editor.originalImg.width;
        exportCanvas.height = editor.originalImg.height;

        const currentCanvas = editor.canvas;
        const currentCtx = editor.ctx;
        const currentActive = editor.activeImg;

        editor.canvas = exportCanvas;
        editor.ctx = exportCanvas.getContext('2d');
        editor.activeImg = editor.originalImg; 

        editor.initNoisePattern();
        editor.render();

        const link = document.createElement('a');
        link.download = `foton_darkroom_highres_${Date.now()}.jpg`;
        link.href = exportCanvas.toDataURL('image/jpeg', 0.95);
        link.click();

        // Çizim bittikten sonra hafif önizleme ayarlarına geri dönüyoruz
        editor.canvas = currentCanvas;
        editor.ctx = currentCtx;
        editor.activeImg = currentActive;
        editor.initNoisePattern();
        editor.render();

        btnSave.innerText = "💾 FULL-RES GÖRSELİ KAYDET (16MP+)";
        btnSave.disabled = false;
    }, 50);
}

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./service-worker.js');
    });
}

window.addEventListener('DOMContentLoaded', initApp);