#include <libraw/libraw.h>
#include <cstdlib>
#include <cstring>
#include <cstdint>

#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#define EXPORT_FN EMSCRIPTEN_KEEPALIVE
#else
#define EXPORT_FN
#endif

extern "C" {

struct RawMetadata {
    int width;
    int height;
    int raw_width;
    int raw_height;
    int flip; // 0, 3 (180 deg), 5 (90 deg CCW), 6 (90 deg CW)
    int colors;
    float iso;
    float shutter;
    float aperture;
    float focal_length;
    float cam_mul[4];
    float rgb_cam[3][4];
    char make[64];
    char model[64];
};

struct RawProcessedImage {
    int width;
    int height;
    int colors;
    int bits;
    uint32_t data_size;
    uint8_t* data;
    void* internal_ptr; // libraw_processed_image_t
};

struct RawThumbnail {
    int format; // 1 = JPEG, 2 = BITMAP
    uint32_t data_size;
    uint8_t* data;
    void* internal_ptr; // libraw_processed_image_t
};

EXPORT_FN void* raw_create() {
    libraw_data_t* lr = libraw_init(0);
    return (void*)lr;
}

EXPORT_FN int raw_open_buffer(void* handle, const uint8_t* buffer, size_t size) {
    if (!handle || !buffer || size == 0) return -1;
    libraw_data_t* lr = (libraw_data_t*)handle;
    
    int ret = libraw_open_buffer(lr, buffer, size);
    if (ret != LIBRAW_SUCCESS) {
        return ret;
    }
    
    ret = libraw_unpack(lr);
    return ret;
}

EXPORT_FN int raw_get_metadata(void* handle, RawMetadata* out) {
    if (!handle || !out) return -1;
    libraw_data_t* lr = (libraw_data_t*)handle;

    out->width = lr->sizes.width;
    out->height = lr->sizes.height;
    out->raw_width = lr->sizes.raw_width;
    out->raw_height = lr->sizes.raw_height;
    out->flip = lr->sizes.flip;
    out->colors = lr->idata.colors;

    out->iso = lr->other.iso_speed;
    out->shutter = lr->other.shutter;
    out->aperture = lr->other.aperture;
    out->focal_length = lr->other.focal_len;

    for (int i = 0; i < 4; i++) {
        out->cam_mul[i] = lr->color.cam_mul[i];
    }

    for (int i = 0; i < 3; i++) {
        for (int j = 0; j < 4; j++) {
            out->rgb_cam[i][j] = lr->color.rgb_cam[i][j];
        }
    }

    strncpy(out->make, lr->idata.make, 63);
    out->make[63] = '\0';
    strncpy(out->model, lr->idata.model, 63);
    out->model[63] = '\0';

    return 0;
}

EXPORT_FN int raw_extract_thumbnail(void* handle, RawThumbnail* out) {
    if (!out) return -1;
    out->format = 0;
    out->data_size = 0;
    out->data = nullptr;
    out->internal_ptr = nullptr;

    if (!handle) return -1;
    libraw_data_t* lr = (libraw_data_t*)handle;

    int ret = libraw_unpack_thumb(lr);
    if (ret != LIBRAW_SUCCESS) {
        return ret;
    }

    int errcode = 0;
    libraw_processed_image_t* thumb = libraw_dcraw_make_mem_thumb(lr, &errcode);
    if (!thumb || errcode != 0) {
        return -2;
    }

    out->format = (int)thumb->type; // LIBRAW_IMAGE_JPEG (1) or LIBRAW_IMAGE_BITMAP (2)
    out->data_size = thumb->data_size;
    out->data = thumb->data;
    out->internal_ptr = (void*)thumb;

    return 0;
}

/**
 * RAW Demosaic and Process:
 * @param half_size: 1 = fast 50% downscaled Bayer preview, 0 = full resolution
 * @param output_bps: 16 (linear 16-bit) or 8
 * @param output_color: 0 = raw camera, 1 = sRGB, 2 = Adobe, 4 = ProPhoto
 * @param highlight_mode: 0 = clip, 1 = unclip, 2 = blend, 5 = rebuild
 */
EXPORT_FN int raw_process_image(
    void* handle,
    int half_size,
    int output_bps,
    int output_color,
    int highlight_mode,
    RawProcessedImage* out
) {
    if (!out) return -1;
    out->width = 0;
    out->height = 0;
    out->colors = 0;
    out->bits = 0;
    out->data_size = 0;
    out->data = nullptr;
    out->internal_ptr = nullptr;

    if (!handle) return -1;
    libraw_data_t* lr = (libraw_data_t*)handle;

    // Lineer ve tam dinamik aralık parametreleri
    lr->params.half_size = half_size ? 1 : 0;
    lr->params.output_bps = (output_bps == 8) ? 8 : 16;
    lr->params.output_color = output_color;
    lr->params.no_auto_bright = 1;
    lr->params.highlight = highlight_mode;
    
    // Doğrusal gama (linear response: 1.0, 1.0)
    lr->params.gamm[0] = 1.0;
    lr->params.gamm[1] = 1.0;

    int ret = libraw_dcraw_process(lr);
    if (ret != LIBRAW_SUCCESS) {
        return ret;
    }

    int errcode = 0;
    libraw_processed_image_t* img = libraw_dcraw_make_mem_image(lr, &errcode);
    if (!img || errcode != 0) {
        return -2;
    }

    out->width = img->width;
    out->height = img->height;
    out->colors = img->colors;
    out->bits = img->bits;
    out->data_size = img->data_size;
    out->data = img->data;
    out->internal_ptr = (void*)img;

    return 0;
}

EXPORT_FN void raw_free_image(RawProcessedImage* out) {
    if (out && out->internal_ptr) {
        libraw_dcraw_clear_mem((libraw_processed_image_t*)out->internal_ptr);
        out->internal_ptr = nullptr;
        out->data = nullptr;
    }
}

EXPORT_FN void raw_free_thumbnail(RawThumbnail* out) {
    if (out && out->internal_ptr) {
        libraw_dcraw_clear_mem((libraw_processed_image_t*)out->internal_ptr);
        out->internal_ptr = nullptr;
        out->data = nullptr;
    }
}

EXPORT_FN void raw_close(void* handle) {
    if (handle) {
        libraw_close((libraw_data_t*)handle);
    }
}

}
