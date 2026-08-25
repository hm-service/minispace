import { Api } from "./api.js?v=70";
import { fmtTime, fullTime, avatarStyle, expandedModeEnabled } from "./utils.js?v=70";

const { reactive, ref, inject, onMounted, onUnmounted, nextTick } = Vue;

export const PostCard = {
    name: "PostCard",
    props: { post: { type: Object, required: true } },
    setup(props) {
        const app = inject("app");
        const postId = props.post.postId;
        const media = props.post.mediaContent;

        // 卡片级图片缓存：key = sha@mode（缩略图与原图共用），随卡片卸载整体释放
        const cache = reactive(new Map());
        const loadingKeys = new Set();
        const expanded = reactive({});
        const expCarousel = reactive({
            postId: null,
            dx: 0,
            dragging: false,
            snapping: false,
            width: 0,
        });
        const expHeight = reactive({});
        const singleImg = reactive({ w: 0, h: 0, ready: false, loaded: false });
        const stageLoaded = ref(false);
        const menuOpen = ref(false);
        let expStart = 0;
        let expStartY = 0;
        let suppressClick = false;

        function imgUrl(sha, mode) {
            const key = sha + (mode ? "@" + mode : "");
            if (cache.has(key)) return cache.get(key);
            if (!loadingKeys.has(key)) {
                loadingKeys.add(key);
                Api.mediaBlob(sha, mode)
                    .then((blob) => cache.set(key, URL.createObjectURL(blob)))
                    .catch(() => cache.set(key, ""));
            }
            return "";
        }

        onUnmounted(() => {
            window.removeEventListener("resize", measureSingle);
            for (const url of cache.values()) {
                if (url) URL.revokeObjectURL(url);
            }
            cache.clear();
        });

        function swallowNextClick() {
            suppressClick = true;
            setTimeout(() => {
                suppressClick = false;
            }, 350);
        }

        // ---- 卡片内大图（仅桌面端启用，见 expandedModeEnabled） ----
        function expSha() {
            return media[expanded[postId] ?? 0]?.sha256 || "";
        }
        function expNextSha() {
            return media[(expanded[postId] ?? 0) + 1]?.sha256 || "";
        }
        function expPrevSha() {
            const i = (expanded[postId] ?? 0) - 1;
            return i >= 0 ? media[i]?.sha256 || "" : "";
        }
        function expStep(d) {
            const next = (expanded[postId] ?? 0) + d;
            if (next >= 0 && next < media.length) expanded[postId] = next;
        }
        function collapse() {
            if (suppressClick) {
                suppressClick = false;
                return;
            }
            expanded[postId] = null;
        }

        function expStageStyle() {
            const h = expHeight[postId];
            return h ? { height: h + "px" } : {};
        }
        function applyExpHeight(maxRatio) {
            if (!maxRatio) return;
            const el = document.querySelector(`.post-expand .exp-stage[data-post="${postId}"]`);
            const width = el ? el.clientWidth : 300;
            // 单图帖：撑满宽度、完整比例高度，不设 72vh 上限；多图帖维持上限
            const height =
                media.length === 1
                    ? width * maxRatio
                    : Math.min(window.innerHeight * 0.72, width * maxRatio);
            expHeight[postId] = Math.round(height);
        }
        function measureExpHeight() {
            const known = media.filter((m) => m.width > 0 && m.height > 0);
            if (known.length === media.length) {
                applyExpHeight(Math.max(...media.map((m) => m.height / m.width)));
            }
            // 旧数据缺尺寸：不计算，等原图请求懒修复后自然补上
        }
        function openExpanded(i) {
            expanded[postId] = i;
            nextTick(measureExpHeight);
        }
        function onGridClick(i) {
            if (expandedModeEnabled()) {
                openExpanded(i);
            } else {
                app.openLightbox(postId, i);
            }
        }

        // ---- 卡片轮播（拖动跟随） ----
        function expStartDrag(x, width) {
            if (expCarousel.dragging) return;
            expCarousel.postId = postId;
            expCarousel.dragging = true;
            expCarousel.snapping = false;
            expCarousel.dx = 0;
            expCarousel.width = width || 300;
            expStart = x;
        }
        function expFinishDrag() {
            if (!expCarousel.dragging || expCarousel.postId !== postId) return;
            const w = expCarousel.width || 300;
            const dx = expCarousel.dx;
            const threshold = Math.min(80, w * 0.28);
            const hasTarget = dx < 0 ? !!expNextSha() : !!expPrevSha();
            if (Math.abs(dx) < threshold || !hasTarget) snapExpBack();
            else snapExpTo(dx < 0 ? 1 : -1);
        }
        function snapExpBack() {
            expCarousel.snapping = true;
            expCarousel.dx = 0;
            setTimeout(expResetDrag, 220);
        }
        function snapExpTo(d) {
            expCarousel.snapping = true;
            expCarousel.dx = -d * expCarousel.width;
            setTimeout(() => {
                expResetDrag();
                expStep(d);
                swallowNextClick();
            }, 220);
        }
        function expResetDrag() {
            if (expCarousel.postId !== postId) return;
            expCarousel.dragging = false;
            expCarousel.snapping = false;
            expCarousel.dx = 0;
            expCarousel.postId = null;
        }

        function expCurrentStyle() {
            const c = expCarousel;
            if (c.postId !== postId || !c.dragging) return {};
            return {
                transform: `translateX(${c.dx}px)`,
                transition: c.snapping ? "transform .22s ease" : "none",
            };
        }
        function expNextStyle() {
            const c = expCarousel;
            if (c.postId !== postId || !c.dragging || c.dx >= 0) return { display: "none" };
            return {
                transform: `translateX(calc(100% + ${c.dx}px))`,
                transition: c.snapping ? "transform .22s ease" : "none",
            };
        }
        function expPrevStyle() {
            const c = expCarousel;
            if (c.postId !== postId || !c.dragging || c.dx <= 0) return { display: "none" };
            return {
                transform: `translateX(calc(-100% + ${c.dx}px))`,
                transition: c.snapping ? "transform .22s ease" : "none",
            };
        }

        function onExpTouchStart(e) {
            if (e.touches.length >= 2) {
                return; // 双指手势不再进入全屏
            }
            if (expCarousel.dragging) return;
            const t = e.changedTouches[0];
            expStart = t.clientX;
            expStartY = t.clientY;
            const stage = e.currentTarget.querySelector(".exp-stage");
            expStartDrag(t.clientX, stage ? stage.clientWidth : 300);
        }
        function onExpTouchMove(e) {
            if (!expCarousel.dragging) return;
            const t = e.changedTouches[0];
            const dx = t.clientX - expStart;
            const dy = t.clientY - expStartY;
            if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 8) {
                e.preventDefault();
                expCarousel.dx = dx;
            } else if (Math.abs(dy) > 12) {
                expResetDrag();
            }
        }
        function onExpTouchEnd() {
            expFinishDrag();
        }
        function onExpTouchCancel() {
            expResetDrag();
        }

        function onExpMouseDown(e) {
            if (expCarousel.dragging) return;
            const stage = e.currentTarget.querySelector(".exp-stage");
            expStartDrag(e.clientX, stage ? stage.clientWidth : 300);
            window.addEventListener("mousemove", onExpMouseMove);
            window.addEventListener("mouseup", onExpMouseUp);
        }
        function onExpMouseMove(e) {
            if (!expCarousel.dragging) return;
            expCarousel.dx = e.clientX - expStart;
        }
        function onExpMouseUp() {
            window.removeEventListener("mousemove", onExpMouseMove);
            window.removeEventListener("mouseup", onExpMouseUp);
            expFinishDrag();
        }

        const gridClass = (list) => (list.length === 1 ? "grid single" : "grid");
        function singleAspect(m) {
            return m.width && m.height ? { aspectRatio: m.width + " / " + m.height } : {};
        }
        function applySingleSize(ow, oh) {
            if (media.length !== 1 || !ow || !oh) return;
            const el = document.querySelector(`.grid.single[data-post="${postId}"]`);
            if (!el) return;
            const cw = el.clientWidth || 300;
            const ratio = oh / ow;
            let w = cw;
            let h = w * ratio;
            if (h > 480) {
                h = 480;
                w = h / ratio;
            }
            singleImg.w = Math.max(1, Math.round(w));
            singleImg.h = Math.max(1, Math.round(h));
            singleImg.ready = true;
        }
        function measureSingle() {
            const m = media[0];
            if (m && m.width > 0 && m.height > 0) applySingleSize(m.width, m.height);
        }
        function onSingleLoad(e) {
            const n = e.target;
            // 以真实显示尺寸为准：覆盖旧数据 0 尺寸与 EXIF 旋转方向不一致两种情况
            if (n.naturalWidth && n.naturalHeight) applySingleSize(n.naturalWidth, n.naturalHeight);
            singleImg.loaded = true;
        }
        function onExpImgLoad(e) {
            stageLoaded.value = true;
            // 单图帖：以加载后图片的真实比例重算舞台高度，覆盖 EXIF/媒体尺寸不一致
            if (media.length === 1) {
                const n = e.target;
                if (n.naturalWidth && n.naturalHeight) {
                    const el = e.target.parentElement; // .exp-stage
                    const width = el ? el.clientWidth : 300;
                    expHeight[postId] = Math.round((width * n.naturalHeight) / n.naturalWidth);
                }
            }
        }
        function openMenu() {
            menuOpen.value = true;
        }
        function closeMenu() {
            menuOpen.value = false;
        }
        function favorite() {
            menuOpen.value = false;
            app.showInfo("收藏", "收藏功能开发中，敬请期待");
        }
        function openPost() {
            menuOpen.value = false;
            location.href = location.origin + "/posts/" + postId;
        }
        function copyTextFallback(text) {
            const ta = document.createElement("textarea");
            ta.value = text;
            ta.setAttribute("readonly", "");
            ta.style.position = "fixed";
            ta.style.opacity = "0";
            document.body.appendChild(ta);
            ta.select();
            let ok = false;
            try {
                ok = document.execCommand("copy");
            } catch {}
            document.body.removeChild(ta);
            return ok;
        }
        async function copyLink() {
            menuOpen.value = false;
            const url = location.origin + "/posts/" + postId;
            try {
                const ok =
                    navigator.clipboard && window.isSecureContext
                        ? (await navigator.clipboard.writeText(url), true)
                        : copyTextFallback(url);
                app.showToast(ok ? "链接已复制" : "复制失败，请手动复制");
            } catch {
                app.showToast("复制失败，请手动复制");
            }
        }
        function menuDelete() {
            menuOpen.value = false;
            app.removePost(postId);
        }

        onMounted(() => {
            nextTick(measureSingle);
            window.addEventListener("resize", measureSingle);
        });

        return {
            post: props.post,
            me: app.me,
            comments: app.comments,
            commentText: app.commentText,
            sendingComment: app.sendingComment,
            removePost: app.removePost,
            openLightbox: app.openLightbox,
            sendComment: app.sendComment,
            onCommentInput: app.onCommentInput,
            onCommentKeydown: app.onCommentKeydown,
            removeComment: app.removeComment,
            toggleTime: app.toggleTime,
            displayTime: app.displayTime,
            avatarStyle,
            fmtTime,
            fullTime,
            gridClass,
            singleAspect,
            singleImg,
            onSingleLoad,
            stageLoaded,
            onExpImgLoad,
            menuOpen,
            openMenu,
            closeMenu,
            favorite,
            copyLink,
            menuDelete,
            openPost,
            imgUrl,
            media,
            expanded,
            expandedModeEnabled,
            expSha,
            expNextSha,
            expPrevSha,
            expStep,
            collapse,
            expStageStyle,
            expCurrentStyle,
            expNextStyle,
            expPrevStyle,
            openExpanded,
            onGridClick,
            onExpTouchStart,
            onExpTouchMove,
            onExpTouchEnd,
            onExpTouchCancel,
            onExpMouseDown,
        };
    },
    template: `
    <article class="post card">
      <header>
        <span class="avatar" :style="avatarStyle(post.userId)">{{ post.nickname[0] }}</span>
        <div class="meta">
          <div class="nick">{{ post.nickname }}</div>
          <div class="time" @click="toggleTime('p:' + post.postId)">
            {{ displayTime('p:' + post.postId, post.createdAt) }}
          </div>
        </div>
        <div class="post-menu">
          <button class="kebab" @click.stop="openMenu">⋮</button>
          <div v-if="menuOpen" class="menu-mask" @click.stop="closeMenu"></div>
          <div v-if="menuOpen" class="menu-pop">
            <button class="menu-item" @click="openPost">打开</button>
            <button class="menu-item" @click="favorite">收藏</button>
            <button class="menu-item" @click="copyLink">复制链接</button>
            <button v-if="post.userId === me.userId" class="menu-item del" @click="menuDelete">删除</button>
          </div>
        </div>
      </header>
      <p class="text">{{ post.textContent }}</p>
      <div v-if="expandedModeEnabled() && typeof expanded[post.postId] === 'number'" class="post-expand"
           @touchstart="onExpTouchStart($event)"
           @touchmove="onExpTouchMove"
           @touchend="onExpTouchEnd"
           @touchcancel="onExpTouchCancel"
           @mousedown.prevent="onExpMouseDown($event)">
        <div class="expand-bar">
          <button class="ghost small" @click="collapse()">收起</button>
          <span class="exp-count">{{ (expanded[post.postId] ?? 0) + 1 }} / {{ media.length }}</span>
          <button class="ghost small" @click="openLightbox(post.postId, expanded[post.postId] ?? 0)">⛶ 大图</button>
        </div>
        <div class="exp-stage" :class="{ 'stage-loaded': stageLoaded, 'exp-single': media.length === 1 }"
             :data-post="post.postId" :style="expStageStyle()">
          <img v-if="expPrevSha()" class="exp-img" :src="imgUrl(expPrevSha(), 'medium')"
               :style="expPrevStyle()" draggable="false">
          <img class="exp-img" :src="imgUrl(expSha(), 'medium')" @load="onExpImgLoad"
               :style="expCurrentStyle()" draggable="false"
               @click="collapse()">
          <img v-if="expNextSha()" class="exp-img" :src="imgUrl(expNextSha(), 'medium')"
               :style="expNextStyle()" draggable="false">
          <button v-if="expPrevSha()" class="exp-edge prev" title="上一张"
                  @click.stop="expStep(-1)" @mousedown.stop>
            <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
              <path d="M15 6l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2.5"
                    stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
          <button v-if="expNextSha()" class="exp-edge next" title="下一张"
                  @click.stop="expStep(1)" @mousedown.stop>
            <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
              <path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.5"
                    stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
        </div>
      </div>
      <div v-else-if="media.length" :class="gridClass(media)" :data-post="post.postId">
        <img v-for="(m, i) in media" :key="i"
             :src="imgUrl(m.sha256, media.length === 1 ? 'medium' : 'small')"
             :style="media.length === 1 && singleImg.ready
               ? { width: singleImg.w + 'px', height: singleImg.h + 'px' }
               : (media.length === 1 ? singleAspect(m) : undefined)"
             :class="media.length === 1 && singleImg.loaded ? 'img-loaded' : undefined"
             loading="lazy" @load="onSingleLoad"
             @click="onGridClick(i)">
      </div>
      <div class="comments">
        <p v-if="!(comments[post.postId] || []).length" class="no-comment">还没有评论</p>
        <div v-for="c in comments[post.postId] || []" :key="c.commentId" class="comment">
          <b>{{ c.nickname }}</b>{{ c.content }}
          <button v-if="c.userId === me.userId" class="link del small-del"
                  @click="removeComment(post.postId, c.commentId)">删除</button>
          <div class="time" @click="toggleTime('c:' + c.commentId)">
            {{ displayTime('c:' + c.commentId, c.createdAt) }}
          </div>
        </div>
        <div class="comment-box">
          <textarea v-model="commentText[post.postId]" rows="1" maxlength="500" placeholder="写评论…"
                    :data-post="post.postId"
                    @input="onCommentInput(post.postId, $event)"
                    @keydown="onCommentKeydown(post.postId, $event)"></textarea>
          <button class="primary small" :disabled="sendingComment[post.postId]"
                  @click="sendComment(post.postId)">发送</button>
        </div>
      </div>
    </article>
  `,
};
