#!/usr/bin/env bash
set -e

SCRIPT_PATH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_PATH="$(dirname "$SCRIPT_PATH")"
EMSDK_PATH="$ROOT_PATH/tools/emsdk"
OUT_PATH="$ROOT_PATH/public/wasm"

echo "=== Foton: Karanlık Oda — LibRaw WASM Derleme ==="

if [ -f "$EMSDK_PATH/emsdk_env.sh" ]; then
    source "$EMSDK_PATH/emsdk_env.sh"
else
    echo "Hata: emsdk_env.sh bulunamadı ($EMSDK_PATH)."
    exit 1
fi

mkdir -p "$OUT_PATH"

# Tüm cpp dosyalarını topla, ancak PhaseOne yekpare demeti olan *_ph.cpp dosyalarını hariç tut
ALL_SOURCES=()
while IFS= read -r file; do
    if [[ "$file" != *"_ph.cpp" ]]; then
        ALL_SOURCES+=("$file")
    fi
done < <(find "$SCRIPT_PATH/LibRaw/src" -name "*.cpp")

ALL_SOURCES+=("$SCRIPT_PATH/libraw_wrapper.cpp")

echo "Derleniyor: ${#ALL_SOURCES[@]} kaynak dosyası..."

em++ -O3 -msimd128 \
    -DLIBRAW_NOTHREADS \
    -w \
    -I "$SCRIPT_PATH/LibRaw" \
    -I "$SCRIPT_PATH/LibRaw/libraw" \
    -sWASM=1 \
    -sALLOW_MEMORY_GROWTH=1 \
    -sINITIAL_MEMORY=134217728 \
    -sMAXIMUM_MEMORY=2147483648 \
    -sMODULARIZE=1 \
    -sEXPORT_ES6=1 \
    -sEXPORT_NAME="createLibRawModule" \
    -sEXPORTED_FUNCTIONS='["_malloc", "_free", "_raw_create", "_raw_open_buffer", "_raw_get_metadata", "_raw_extract_thumbnail", "_raw_process_image", "_raw_free_image", "_raw_free_thumbnail", "_raw_close"]' \
    -sEXPORTED_RUNTIME_METHODS='["ccall", "cwrap", "getValue", "setValue", "HEAPU8", "HEAPU16", "HEAP32", "HEAPF32", "UTF8ToString"]' \
    "${ALL_SOURCES[@]}" \
    -o "$OUT_PATH/libraw.js"

echo "✓ LibRaw WASM başarıyla derlendi -> $OUT_PATH/libraw.js & libraw.wasm"
ls -lh "$OUT_PATH/libraw.wasm" "$OUT_PATH/libraw.js"
