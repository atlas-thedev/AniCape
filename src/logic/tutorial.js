function initTutorial() {
    const tutorialBtn = document.getElementById('tutorialBtn');
    if (tutorialBtn) tutorialBtn.addEventListener('click', startTutorial);


}

function startTutorial() {
    if (!window.driver || !window.driver.js) return;
    const driver = window.driver.js.driver;

    const steps = [
        { popover: { title: getTranslation('tour_welcome_title'), description: getTranslation('tour_welcome_desc') } },
        { element: '#workspace', popover: { title: getTranslation('tour_workspace_title'), description: getTranslation('tour_workspace_desc'), side: "left", align: 'start' } },
        ...(window.innerWidth > 768 ? [
            { element: '#workspace', popover: { title: getTranslation('tour_drag_drop_title'), description: getTranslation('tour_drag_drop_desc'), side: "left", align: 'center' } },
            { element: '#shortcutsHint', popover: { title: getTranslation('tour_shortcuts_title'), description: getTranslation('tour_shortcuts_desc'), side: "right", align: 'end' } }
        ] : []),
        { element: '.zoom-controls', popover: { title: getTranslation('tour_zoom_title'), description: getTranslation('tour_zoom_desc'), side: "top", align: 'end' } },
        {
            element: '.history-controls',
            popover: { title: getTranslation('tour_history_title'), description: getTranslation('tour_history_desc'), side: "bottom", align: 'start' },
            onHighlightStarted: () => { if (window.innerWidth <= 768) document.getElementById('sidebar')?.classList.remove('open'); }
        }
    ];

    const mobileControls = document.querySelector('.mobile-controls');
    if (mobileControls && window.getComputedStyle(mobileControls).display !== 'none') {
        steps.push({
            element: '.mobile-controls',
            popover: { title: getTranslation('tour_mobile_title'), description: getTranslation('tour_mobile_desc'), side: "top", align: 'start' },
            onHighlightStarted: () => { if (window.innerWidth <= 768) document.getElementById('sidebar')?.classList.remove('open'); }
        });
    }

    steps.push({
        element: '#projectSection',
        popover: { title: getTranslation('tour_project_title'), description: getTranslation('tour_project_desc'), side: window.innerWidth <= 768 ? "bottom" : "left", align: 'start' },
        onHighlightStarted: () => { if (window.innerWidth <= 768) document.getElementById('sidebar')?.classList.add('open'); }
    });

    steps.push({
        element: '#templateSection',
        popover: { title: getTranslation('tour_template_title'), description: getTranslation('tour_template_desc'), side: window.innerWidth <= 768 ? "bottom" : "left", align: 'start' },
        onHighlightStarted: () => { if (window.innerWidth <= 768) document.getElementById('sidebar')?.classList.add('open'); }
    });

    steps.push({
        element: '#dynamicColorList',
        popover: { title: getTranslation('tour_advanced_title'), description: getTranslation('tour_advanced_desc'), side: window.innerWidth <= 768 ? "bottom" : "left", align: 'start' },
        onHighlightStarted: () => {
            if (window.innerWidth <= 768) document.getElementById('sidebar')?.classList.add('open');
            document.getElementById('advContent')?.classList.add('show');
            const sb = document.getElementById('sidebar');
            // Ensure the container is visible and expanded before positioning the popover
            setTimeout(() => {
                document.getElementById('advContent')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 50);
        },
        onDeselected: () => document.getElementById('advContent')?.classList.remove('show')
    });

    steps.push({
        element: '#sidebar .panel-section:nth-child(3)',
        popover: { title: getTranslation('tour_layers_title'), description: getTranslation('tour_layers_desc'), side: window.innerWidth <= 768 ? "bottom" : "left", align: 'start' }
    });

    steps.push({
        element: '#layerProperties',
        popover: { title: getTranslation('tour_properties_title'), description: getTranslation('tour_properties_desc'), side: window.innerWidth <= 768 ? "bottom" : "left", align: 'start' },
        onHighlightStarted: () => {
            if (window.innerWidth <= 768) document.getElementById('sidebar')?.classList.add('open');
            document.getElementById('layerProperties')?.classList.remove('hidden');
            const sb = document.getElementById('sidebar');
            if (sb) sb.scrollTop = sb.scrollHeight;
        },
        onDeselected: () => { if (state.activeLayerId == null) document.getElementById('layerProperties')?.classList.add('hidden'); }
    });

    steps.push({
        element: '#exportBtn',
        popover: { title: getTranslation('tour_export_title'), description: getTranslation('tour_export_desc'), side: "bottom", align: 'center' },
        onHighlightStarted: () => { if (window.innerWidth <= 768) document.getElementById('sidebar')?.classList.remove('open'); }
    });

    steps.push({
        element: '#exportModal .modal-content',
        popover: { title: getTranslation('tour_export_modal_title'), description: getTranslation('tour_export_modal_desc'), side: window.innerWidth <= 768 ? "bottom" : "left", align: 'start' },
        onHighlightStarted: () => {
            const modal = document.getElementById('exportModal');
            if (modal) { modal.style.display = 'flex'; modal.style.background = 'transparent'; modal.style.zIndex = '100001'; }
        },
        onDeselected: () => {
            const modal = document.getElementById('exportModal');
            if (modal) { modal.style.display = 'none'; modal.style.background = ''; modal.style.zIndex = ''; }
        }
    });

    steps.push({ popover: { title: getTranslation('tour_end_title'), description: getTranslation('tour_end_desc') } });

    const dObj = driver({
        showProgress: true, animate: true, allowClose: true,
        nextBtnText: getTranslation('tour_next'),
        prevBtnText: getTranslation('tour_prev'),
        doneBtnText: getTranslation('tour_done'),
        steps: steps,
        onDestroyed: () => {
            if (window.innerWidth <= 768) document.getElementById('sidebar')?.classList.remove('open');
            document.getElementById('advContent')?.classList.remove('show');
            if (state.activeLayerId == null) document.getElementById('layerProperties')?.classList.add('hidden');
            const m = document.getElementById('exportModal');
            if (m && m.style.display !== 'none') {
                document.getElementById('exportCloseBtn')?.click();
                m.style.background = ''; m.style.zIndex = '';
            }
        }
    });
    dObj.drive();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initTutorial);
else initTutorial();
