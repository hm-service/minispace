import { Api } from "./api.js?v=70";

const { reactive, nextTick } = Vue;

// 全屏大图（根级，独立缓存，关闭时释放；先 medium 立即出图，后台升级原图）
export function useLightbox(posts, draft) {
    const lightbox = reactive({ show: false, postId: null, items: [], index: 0 });
    // ---- 全屏大图 ----
    const lbCache = reactive(new Map()); // 原图
    const lbLoading = new Set();
    const lbMedium = reactive(new Map()); // medium 占位
    const lbMediumLoading = new Set();
    function lbImgUrl(sha) {
        if (!sha) return "";
        if (lbCache.has(sha)) return lbCache.get(sha);
        if (!lbMedium.has(sha) && !lbMediumLoading.has(sha)) {
            lbMediumLoading.add(sha);
            Api.mediaBlob(sha, "medium")
                .then((blob) => lbMedium.set(sha, URL.createObjectURL(blob)))
                .catch(() => lbMedium.set(sha, ""));
        }
        if (!lbLoading.has(sha)) {
            lbLoading.add(sha);
            Api.mediaBlob(sha)
                .then((blob) => {
                    const old = lbCache.get(sha);
                    if (old) URL.revokeObjectURL(old);
                    lbCache.set(sha, URL.createObjectURL(blob));
                })
                .catch(() => lbCache.set(sha, ""));
        }
        return lbMedium.get(sha) || "";
    }
    function lbAdjacentUrl(sha) {
        if (!sha) return "";
        if (lbCache.has(sha)) return lbCache.get(sha);
        if (!lbMedium.has(sha) && !lbMediumLoading.has(sha)) {
            lbMediumLoading.add(sha);
            Api.mediaBlob(sha, "medium")
                .then((blob) => lbMedium.set(sha, URL.createObjectURL(blob)))
                .catch(() => lbMedium.set(sha, ""));
        }
        return lbMedium.get(sha) || "";
    }
    function lbSha(offset) {
        const it = lightbox.items[lightbox.index + offset];
        return it && it.type === "sha" ? it.sha : "";
    }

    function openLightbox(postId, index) {
        const p = posts.value.find((x) => x.postId === postId);
        if (!p || !p.mediaContent.length) return;
        clearTimeout(tapCloseTimer);
        lastTap = 0;
        lightbox.postId = postId;
        lightbox.items = p.mediaContent.map((m) => ({ type: "sha", sha: m.sha256 }));
        lightbox.index = Math.max(0, Math.min(index, lightbox.items.length - 1));
        resetZoom();
        lightbox.show = true;
        nextTick(() => {
            currentSrc();
            measureLb();
        });
    }

    function openPreview(index) {
        if (!draft.previews.length || draft.uploading) return;
        clearTimeout(tapCloseTimer);
        lastTap = 0;
        lightbox.postId = null;
        lightbox.items = draft.previews.map((url) => ({ type: "url", url }));
        lightbox.index = Math.max(0, Math.min(index, lightbox.items.length - 1));
        resetZoom();
        lightbox.show = true;
        nextTick(() => {
            currentSrc();
            measureLb();
        });
    }

    function currentSrc() {
        const it = lightbox.items[lightbox.index];
        if (!it) return "";
        return it.type === "url" ? it.url : lbImgUrl(it.sha);
    }
    function lbStep(d) {
        const next = lightbox.index + d;
        if (next >= 0 && next < lightbox.items.length) {
            lightbox.index = next;
            resetZoom();
        }
    }
    function lbCan(d) {
        const next = lightbox.index + d;
        return next >= 0 && next < lightbox.items.length;
    }
    function closeLightbox() {
        if (suppressClick) {
            suppressClick = false;
            return;
        }
        clearTimeout(tapCloseTimer);
        lightbox.show = false;
        resetZoom();
        for (const url of lbCache.values()) {
            if (url) URL.revokeObjectURL(url);
        }
        lbCache.clear();
        lbLoading.clear();
        for (const url of lbMedium.values()) {
            if (url) URL.revokeObjectURL(url);
        }
        lbMedium.clear();
        lbMediumLoading.clear();
    }

    let suppressClick = false;
    function swallowNextClick() {
        suppressClick = true;
        setTimeout(() => {
            suppressClick = false;
        }, 350);
    }

    const lbZoom = reactive({
        scale: 1,
        tx: 0,
        ty: 0,
        anim: false,
        fading: false,
        box: { w: 0, h: 0 },
        stage: { w: 0, h: 0, left: 0, top: 0 },
    });
    let lastTap = 0;
    let tapCloseTimer = null;

    // 全屏轮播：拖动跟随 + 回弹/吸附（与卡片内 expanded 同构）
    const lbDrag = reactive({ on: false, dx: 0, snapping: false, width: 0 });
    let lbDragStartX = 0;
    function lbStageWidth() {
        const stage = document.querySelector(".lb-stage");
        return stage ? stage.clientWidth : window.innerWidth;
    }
    function lbItemStyle(offset) {
        const d = lbDrag;
        const active = d.on || d.snapping;
        const dx = d.dx;
        if (offset === 0) {
            return { transform: active ? `translateX(${dx}px)` : "none" };
        }
        const visible = active && ((offset < 0 && dx > 0) || (offset > 0 && dx < 0));
        return {
            transform: `translateX(calc(${offset * 100}% + ${dx}px))`,
            visibility: visible ? "visible" : "hidden",
        };
    }
    function lbDragMove(x) {
        const w = lbDrag.width || window.innerWidth;
        let dx = x - lbDragStartX;
        // 边缘阻尼：到第一张/最后一张后手感减半
        if (dx < 0 && !lbCan(1)) dx *= 0.4;
        if (dx > 0 && !lbCan(-1)) dx *= 0.4;
        lbDrag.dx = dx;
    }
    function lbDragFinish() {
        if (!lbDrag.on) return;
        lbDrag.on = false;
        const w = lbDrag.width || window.innerWidth;
        const dx = lbDrag.dx;
        const threshold = Math.min(80, w * 0.28);
        const hasTarget = dx < 0 ? lbCan(1) : lbCan(-1);
        if (Math.abs(dx) < threshold || !hasTarget) {
            lbDrag.snapping = true;
            lbDrag.dx = 0;
            setTimeout(lbDragReset, 220);
        } else {
            const d = dx < 0 ? 1 : -1;
            lbDrag.snapping = true;
            lbDrag.dx = -d * w;
            setTimeout(() => {
                lbDragReset();
                lbStep(d);
                swallowNextClick();
            }, 220);
        }
    }
    function lbDragReset() {
        lbDrag.on = false;
        lbDrag.snapping = false;
        lbDrag.dx = 0;
    }

    function measureLb() {
        const el = document.querySelector(".lb-stage .lb-item.current img");
        if (!el) return;
        const stage = document.querySelector(".lb-stage");
        const sr = stage.getBoundingClientRect();
        lbZoom.stage = { w: sr.width, h: sr.height, left: sr.left, top: sr.top };
        lbZoom.box = { w: el.offsetWidth, h: el.offsetHeight };
    }
    function lbMaxPan() {
        return {
            x: Math.max(0, (lbZoom.box.w * lbZoom.scale - lbZoom.stage.w) / 2),
            y: Math.max(0, (lbZoom.box.h * lbZoom.scale - lbZoom.stage.h) / 2),
        };
    }
    function lbClamp() {
        const m = lbMaxPan();
        lbZoom.tx = Math.max(-m.x, Math.min(m.x, lbZoom.tx));
        lbZoom.ty = Math.max(-m.y, Math.min(m.y, lbZoom.ty));
    }
    function lbStagePoint(x, y) {
        const s = lbZoom.stage;
        return { x: x - (s.w ? s.left : 0), y: y - (s.h ? s.top : 0) };
    }
    function setZoom(scale, tx, ty, animate, anchor = null, allowBelowOne = false) {
        const s0 = Math.max(lbZoom.scale, 0.01);
        const s1 = allowBelowOne
            ? Math.min(5, Math.max(0.5, scale))
            : Math.min(5, Math.max(1, scale));
        let t1x = tx;
        let t1y = ty;
        if (anchor) {
            const cx = lbZoom.stage.w / 2;
            const cy = lbZoom.stage.h / 2;
            const ax = anchor.x - cx;
            const ay = anchor.y - cy;
            t1x = ax - (ax - lbZoom.tx) * (s1 / s0);
            t1y = ay - (ay - lbZoom.ty) * (s1 / s0);
        }
        lbZoom.scale = s1;
        lbZoom.tx = t1x;
        lbZoom.ty = t1y;
        if (s1 >= 1) lbClamp();
        if (s1 <= 1 && !allowBelowOne) {
            lbZoom.tx = 0;
            lbZoom.ty = 0;
        }
        lbZoom.anim = animate;
        if (animate)
            setTimeout(() => {
                lbZoom.anim = false;
            }, 220);
        else lbZoom.anim = false;
    }
    function resetZoom() {
        lbZoom.scale = 1;
        lbZoom.tx = 0;
        lbZoom.ty = 0;
        lbZoom.anim = false;
        lbZoom.fading = false;
    }
    function lbImgStyle() {
        let opacity = 1;
        if (lbZoom.fading) {
            opacity = 0;
        } else if (lbZoom.scale < 0.8) {
            opacity = Math.max(0, Math.min(1, (lbZoom.scale - 0.5) / 0.3));
        }
        return {
            transform: `translate(${lbZoom.tx}px, ${lbZoom.ty}px) scale(${lbZoom.scale})`,
            transformOrigin: "center",
            opacity,
            transition: lbZoom.anim ? "transform .2s ease, opacity .2s ease" : "none",
            cursor: lbZoom.scale > 1 ? "grab" : "zoom-in",
        };
    }
    function fadeOutAndClose() {
        lbZoom.fading = true;
        lbZoom.anim = true;
        lbZoom.scale = 0.5;
        setTimeout(() => {
            lbZoom.anim = false;
        }, 160);
        setTimeout(() => closeLightbox(), 160);
    }
    function toggleZoom(e) {
        if (lbZoom.scale > 1) {
            setZoom(1, 0, 0, true);
        } else {
            setZoom(2, lbZoom.tx, lbZoom.ty, true, lbStagePoint(e.clientX, e.clientY));
        }
    }
    function onImgClick(e) {
        if (suppressClick) {
            suppressClick = false;
            return;
        }
        const now = Date.now();
        if (now - lastTap < 300) {
            clearTimeout(tapCloseTimer);
            toggleZoom(e);
            lastTap = 0;
            return;
        }
        lastTap = now;
        clearTimeout(tapCloseTimer);
        tapCloseTimer = setTimeout(() => {
            if (!suppressClick) closeLightbox();
        }, 400);
    }
    function onLbWheel(e) {
        const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
        const next = lbZoom.scale * factor;
        if (next < 0.8) {
            fadeOutAndClose();
            return;
        }
        setZoom(next, lbZoom.tx, lbZoom.ty, true, lbStagePoint(e.clientX, e.clientY));
    }

    let lbTouch = null;
    function onLbTouchStart(e) {
        suppressClick = false;
        const t = e.touches;
        lbTouch = { x1: t[0].clientX, y1: t[0].clientY, x2: null, y2: null, dist: 0, moved: false };
        lbDragStartX = t[0].clientX;
        lbDrag.width = lbStageWidth();
        if (t.length === 2) {
            lbTouch.x2 = t[1].clientX;
            lbTouch.y2 = t[1].clientY;
            lbTouch.dist = Math.hypot(t[1].clientX - t[0].clientX, t[1].clientY - t[0].clientY);
        }
    }
    function onLbTouchMove(e) {
        if (!lbTouch) return;
        const t = e.touches;
        if (t.length === 2) {
            if (lbDrag.on) lbDragReset();
            e.preventDefault();
            lbTouch.moved = true;
            const dist = Math.hypot(t[1].clientX - t[0].clientX, t[1].clientY - t[0].clientY);
            if (lbTouch.dist > 0) {
                const anchor = lbStagePoint(
                    (t[0].clientX + t[1].clientX) / 2,
                    (t[0].clientY + t[1].clientY) / 2,
                );
                setZoom(
                    (lbZoom.scale * dist) / lbTouch.dist,
                    lbZoom.tx,
                    lbZoom.ty,
                    false,
                    anchor,
                    true,
                );
            }
            lbTouch.x1 = t[0].clientX;
            lbTouch.y1 = t[0].clientY;
            lbTouch.x2 = t[1].clientX;
            lbTouch.y2 = t[1].clientY;
            lbTouch.dist = dist;
        } else if (t.length === 1 && lbZoom.scale > 1) {
            e.preventDefault();
            lbTouch.moved = true;
            lbZoom.tx += t[0].clientX - lbTouch.x1;
            lbZoom.ty += t[0].clientY - lbTouch.y1;
            lbClamp();
            lbTouch.x1 = t[0].clientX;
            lbTouch.y1 = t[0].clientY;
        } else if (t.length === 1 && lbZoom.scale === 1) {
            const dx = t[0].clientX - lbTouch.x1;
            const dy = t[0].clientY - lbTouch.y1;
            if (!lbDrag.on && Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 8) {
                lbDrag.on = true;
                lbTouch.moved = true;
            }
            if (lbDrag.on) {
                e.preventDefault();
                lbDragMove(t[0].clientX);
            }
        }
    }
    function onLbTouchEnd(e) {
        if (!lbTouch) return;
        const t = e.changedTouches;
        if (e.touches.length === 0) {
            if (lbZoom.scale < 0.8) {
                fadeOutAndClose();
            } else if (lbZoom.scale < 1) {
                setZoom(1, 0, 0, true);
                if (lbTouch.moved) swallowNextClick();
            } else if (lbZoom.scale > 1) {
                if (lbTouch.moved) swallowNextClick();
            } else if (lbDrag.on) {
                lbDragFinish();
                swallowNextClick();
            }
            lbTouch = null;
        } else if (e.touches.length === 1) {
            lbTouch.x1 = e.touches[0].clientX;
            lbTouch.y1 = e.touches[0].clientY;
            lbTouch.x2 = null;
            lbTouch.y2 = null;
            lbTouch.dist = 0;
            lbTouch.moved = false;
        }
    }
    function onLbTouchCancel() {
        if (lbDrag.on) lbDragReset();
        lbTouch = null;
    }

    const drag = { on: false, x: 0, y: 0, moved: false };
    function onLbMouseDown(e) {
        suppressClick = false;
        drag.on = true;
        drag.moved = false;
        drag.x = e.clientX;
        drag.y = e.clientY;
        lbDragStartX = e.clientX;
        lbDrag.width = lbStageWidth();
        window.addEventListener("mousemove", onLbMouseMove);
        window.addEventListener("mouseup", onLbMouseUp);
    }
    function onLbMouseMove(e) {
        if (!drag.on) return;
        const dx = e.clientX - drag.x;
        const dy = e.clientY - drag.y;
        if (lbZoom.scale > 1) {
            drag.moved = true;
            drag.x = e.clientX;
            drag.y = e.clientY;
            lbZoom.tx += dx;
            lbZoom.ty += dy;
            lbClamp();
        } else if (lbZoom.scale === 1) {
            if (!lbDrag.on && Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 4) {
                lbDrag.on = true;
                drag.moved = true;
            }
            if (lbDrag.on) {
                drag.moved = true;
                lbDragMove(e.clientX);
            }
        }
    }
    function onLbMouseUp() {
        if (lbDrag.on) lbDragFinish();
        if (drag.moved) swallowNextClick();
        drag.on = false;
        drag.moved = false;
        window.removeEventListener("mousemove", onLbMouseMove);
        window.removeEventListener("mouseup", onLbMouseUp);
    }

    window.addEventListener("keydown", (e) => {
        if (!lightbox.show) return;
        if (e.key === "Escape") closeLightbox();
        else if (e.key === "ArrowRight") lbStep(1);
        else if (e.key === "ArrowLeft") lbStep(-1);
    });

    return {
        lightbox,
        currentSrc,
        lbStep,
        lbCan,
        closeLightbox,
        openLightbox,
        openPreview,
        lbImgUrl,
        lbAdjacentUrl,
        lbSha,
        lbItemStyle,
        onLbTouchStart,
        onLbTouchMove,
        onLbTouchEnd,
        onLbTouchCancel,
        onLbMouseDown,
        onLbWheel,
        onImgClick,
        lbImgStyle,
        measureLb,
    };
}
