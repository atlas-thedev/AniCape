// ============================================================
// EXPORT - 3D PREVIEW (skinview3d)
// ============================================================

let skinViewerInstance = null;
let previewAnimationRequest = null;
let previewResizeObserver=null;

/**
 * Initializes the skinview3d viewer on the provided canvas.
 */
function init3DPreview(canvas, skinUrl) {
    cleanup3DPreview();
    
    try {
        skinViewerInstance = new skinview3d.SkinViewer({
            canvas: canvas,
            width: Math.max(1,canvas.clientWidth),
            pixelRatio:Math.min(2,window.devicePixelRatio||1),
            height: Math.max(1,canvas.clientHeight),
            skin: skinUrl,
        });

        const control = skinViewerInstance.controls;
        control.enableRotate = true;
        control.enableZoom = true;
        control.enablePan = false;

        skinViewerInstance.camera.position.set(0, 10, -40);
        skinViewerInstance.zoom = 0.8;
        
        previewResizeObserver=new ResizeObserver(()=>{if(skinViewerInstance)skinViewerInstance.setSize(Math.max(1,canvas.clientWidth),Math.max(1,canvas.clientHeight));});
        previewResizeObserver.observe(canvas);
        return skinViewerInstance;
    } catch (e) {
        console.error("Failed to initialize SkinViewer", e);
        return null;
    }
}

/**
 * Disposes the viewer and stops any active animation loops.
 */
function cleanup3DPreview() {
    previewResizeObserver?.disconnect();previewResizeObserver=null;
    if (previewAnimationRequest) {
        cancelAnimationFrame(previewAnimationRequest);
        previewAnimationRequest = null;
    }
    if (skinViewerInstance) {
        skinViewerInstance.dispose();
        skinViewerInstance = null;
    }
}

/**
 * Starts an animation loop to play back cape frames on the 3D model.
 */
function startCapeAnimation(frames, type) {
    if (previewAnimationRequest) cancelAnimationFrame(previewAnimationRequest);
    if (!skinViewerInstance || !frames || frames.length <= 1) return;

    let startTime = performance.now();
    // Wynntils cycle is 2s, MinecraftCapes is 100ms per frame
    const duration = frames.length / (window.nativeContestFPS||10) * 1000;
    let lastFrame=-1;

    const animate = (time) => {
        if (!skinViewerInstance || !frames) return;
        const elapsed = time - startTime;
        const progress = (elapsed / duration) % 1;
        const frameIndex = Math.floor(progress * frames.length);
        
        if (frames[frameIndex] && frameIndex!==lastFrame) {
            lastFrame=frameIndex;
            skinViewerInstance.loadCape(frames[frameIndex], { backEquipment: type });
        }
        previewAnimationRequest = requestAnimationFrame(animate);
    };
    previewAnimationRequest = requestAnimationFrame(animate);
}

/**
 * Simple wrapper to update the texture without changing equipment type.
 */
function updatePreviewTexture(texture, type) {
    if (skinViewerInstance) {
        skinViewerInstance.loadCape(texture, { backEquipment: type });
    }
}
