import { PhotoEditor } from './editor.js';

let editor;

const fileInput = document.getElementById('file-input');
const btnUpload = document.getElementById('btn-upload');
const btnRotate = document.getElementById('btn-rotate');
const btnReset = document.getElementById('btn-reset');
const btnSave = document.getElementById('btn-save');
const placeholder = document.getElementById('no-image-placeholder');
const canvas = document.getElementById('editor-canvas');

const sliders = {
    exposure: document.getElementById('slider-exposure'),
    contrast: document.getElementById('slider-contrast'),
    saturation: document.getElementById('slider-saturation'),
    warmth: document.getElementById('slider-warmth'),
    swirl: document.getElementById('slider-swirl'),
    chromatic: document.getElementById('slider-chromatic'),
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

async function loadHeicScript() {
    if (window.heic2any) return; 
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = "./js/heic2any.min.js"; 
        script.onload = resolve;
        script.onerror = () => reject(new Error("Çevrimdışı HEIF çözücü yüklenemedi."));
        document.head.appendChild(script);
    });
}

function flattenTransparentImage(img) {
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = img.width;
    tempCanvas.height = img.height;
    const tempCtx = tempCanvas.getContext('2d');
    
    tempCtx.fillStyle = '#FFFFFF';
    tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
    tempCtx.drawImage(img, 0, 0);
    
    const flattenedImg = new Image();
    flattenedImg.src = tempCanvas.toDataURL('image/jpeg', 1.0);

    tempCanvas.width = 0;
    tempCanvas.height = 0;

    return flattenedImg;
}

async function handleFileLoad(e) {
    let file = e.target.files[0];
    if (!file) return;

    const fileType = file.type;
    const fileName = file.name.toLowerCase();
    const isHeic = fileName.endsWith('.heic') || fileName.endsWith('.heif') || fileType === 'image/heic' || fileType === 'image/heif';

    if (isHeic) {
        const originalBtnText = btnUpload.innerText;
        btnUpload.innerText = "🔄 HEIF ÇÖZÜMLENİYOR...";
        btnUpload.disabled = true;

        try {
            await loadHeicScript();
            const convertedBlob = await heic2any({
                blob: file,
                toType: "image/jpeg",
                quality: 1.0
            });
            file = Array.isArray(convertedBlob) ? convertedBlob[0] : convertedBlob;
        } catch (error) {
            console.error("HEIF Çözümleme Hatası:", error);
            alert("HEIF görseli çözümlenirken sistem tökezledi.");
            btnUpload.innerText = originalBtnText;
            btnUpload.disabled = false;
            return;
        }

        btnUpload.innerText = originalBtnText;
        btnUpload.disabled = false;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
        let img = new Image();
        img.onload = () => {
            placeholder.classList.add('hidden');
            
            if (fileType === 'image/png' || fileName.endsWith('.png')) {
                img = flattenTransparentImage(img);
                img.onload = () => {
                    editor.loadImage(img, enableSaveUI);
                };
            } else {
                editor.loadImage(img, enableSaveUI);
            }
        };
        img.src = event.target.result;
    };
    reader.readAsDataURL(file);
}

function enableSaveUI() {
    btnRotate.disabled = false;
    btnReset.disabled = false;
    btnSave.disabled = false;
    btnSave.className = "w-full bg-emerald-900 border border-emerald-800 text-emerald-400 py-3 rounded-xl text-xs font-bold tracking-wider transition-colors cursor-pointer";
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

    btnSave.innerText = "💾 İŞLENİYOR...";
    btnSave.disabled = true;

    setTimeout(() => {
        const MAX_DIM = 4000; 
        let w = editor.originalImg.width;
        let h = editor.originalImg.height;

        if (w > MAX_DIM || h > MAX_DIM) {
            if (w > h) {
                h = Math.round((h * MAX_DIM) / w);
                w = MAX_DIM;
            } else {
                w = Math.round((w * MAX_DIM) / h);
                h = MAX_DIM;
            }
        }

        const exportCanvas = document.createElement('canvas');
        exportCanvas.width = w;
        exportCanvas.height = h;

        const currentCanvas = editor.canvas;
        const currentCtx = editor.ctx;
        const currentActive = editor.activeImg;

        editor.canvas = exportCanvas;
        editor.ctx = exportCanvas.getContext('2d');
        editor.activeImg = editor.originalImg; 

        editor.initNoisePattern();
        editor.render();

        exportCanvas.toBlob((blob) => {
            const url = URL.createObjectURL(blob);
            
            const link = document.createElement('a');
            link.download = `foton_darkroom_highres_${Date.now()}.jpg`;
            link.href = url;
            link.click();

            URL.revokeObjectURL(url);

            exportCanvas.width = 0;
            exportCanvas.height = 0;

            editor.canvas = currentCanvas;
            editor.ctx = currentCtx;
            editor.activeImg = currentActive;
            editor.initNoisePattern();
            editor.render();

            btnSave.innerText = "💾 GÖRSELİ KAYDET";
            btnSave.disabled = false;
            
        
        }, 'image/jpeg', 0.97);

    }, 50);
}

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./service-worker.js');
    });
}

window.addEventListener('DOMContentLoaded', initApp);
