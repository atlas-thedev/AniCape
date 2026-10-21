// ============================================================
// EXPORT - CANVAS COMPOSITOR
// ============================================================

/**
 * Synthesizes individual frames of the export by compositing all layers.
 * Handles region masking, rotations, and animations.
 */
function generateExportFrames() {
    if (state.layers.length === 0) return null;

    const animatedLayer = state.layers.find(l => l.visible && l.isAnimated && l.animationData && l.animationData.displayFrames);
    let totalFrames = 1;
    if (animatedLayer) {
        totalFrames = animatedLayer.animationData.displayFrames.length;
    }

    const frames = [];
    const originalShowTemplate = state.showTemplate;
    state.showTemplate = false;

    for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
        const frameCanvas = document.createElement('canvas');
        frameCanvas.width = state.width;
        frameCanvas.height = state.height;
        const frameCtx = frameCanvas.getContext('2d');
        frameCtx.imageSmoothingEnabled = false;

        state.layers.forEach(layer => {
            if (!layer.visible) return;

            let displayImg;
            if (layer.isAnimated && layer.animationData && layer.animationData.displayFrames) {
                const rf = layer.animationData.displayFrames;
                displayImg = rf[frameIndex % rf.length];
            } else if (layer.isSolid) {
                displayImg = layer.solidCanvas || layer.img;
            } else {
                displayImg = layer.img;
            }

            if (!displayImg) return;

            const layerCv = document.createElement('canvas');
            layerCv.width = state.width;
            layerCv.height = state.height;
            const lCtx = layerCv.getContext('2d');
            LayerTransform.applySmoothing(lCtx, layer.smoothing);

            lCtx.save();
            LayerTransform.applyToContext(lCtx, layer);
            lCtx.drawImage(displayImg, -displayImg.width / 2, -displayImg.height / 2);
            lCtx.restore();

            // Apply Region Masking
            if (layer.regions && layer.regions.length > 0) {
                const maskCtx = state.tempMaskCanvas.getContext('2d');
                maskCtx.clearRect(0, 0, state.width, state.height);
                let hasMask = false;
                layer.regions.forEach(regionId => {
                    if (state.masks[regionId]) {
                        maskCtx.drawImage(state.masks[regionId], 0, 0);
                        hasMask = true;
                    }
                });
                if (hasMask) {
                    lCtx.globalCompositeOperation = 'destination-in';
                    lCtx.drawImage(state.tempMaskCanvas, 0, 0);
                }
            }

            frameCtx.save();
            frameCtx.globalAlpha = layer.opacity;
            frameCtx.drawImage(layerCv, 0, 0);
            frameCtx.restore();
        });

        frames.push(frameCanvas);
    }

    state.showTemplate = originalShowTemplate;
    render();
    return frames;
}

/**
 * Searches for a 24-bit color that is NOT present in any of the provided canvases.
 * Used for GIF transparency keying.
 */
function findUnusedColor(canvases) {
    const usedColors = new Set();

    for (const canvas of canvases) {
        const ctx = canvas.getContext('2d');
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;

        for (let i = 0; i < data.length; i += 4) {
            if (data[i + 3] > 0) {
                const hex = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
                usedColors.add(hex);
            }
        }
    }

    // Common Distinctive Alpha Candidates
    const candidates = [
        0xFF00FF, // Magenta
        0x00FF00, // Lime
        0x00FFFF, // Cyan
        0xFFFF00, // Yellow
        0xFF0000, // Red
        0x0000FF, // Blue
        0xFE01FD,
        0x01FE02
    ];

    for (let color of candidates) {
        if (!usedColors.has(color)) return color;
    }

    // Sequence fallback
    for (let r = 0; r < 256; r += 15) {
        for (let g = 0; g < 256; g += 15) {
            for (let b = 0; b < 256; b += 15) {
                const color = (r << 16) | (g << 8) | b;
                if (!usedColors.has(color)) return color;
            }
        }
    }
    return 0xFF00FF; 
}
