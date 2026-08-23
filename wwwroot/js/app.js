const { createApp, ref, reactive, nextTick, inject, provide, onMounted, onUnmounted } = Vue;
console.log('[MiniSpace] frontend v37');

// 阻止页面级双指缩放（lightbox 内捏合本来就会 preventDefault，不受影响）
document.addEventListener('touchmove', (e) => {
  if (e.touches.length > 1) e.preventDefault();
}, { passive: false });

function fmtTime(sec) {
  const d = new Date((sec || 0) * 1000);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return '刚刚';
  if (diff < 3600) return Math.floor(diff / 60) + ' 分钟前';
  if (diff < 86400) return Math.floor(diff / 3600) + ' 小时前';
  if (diff < 86400 * 7) return Math.floor(diff / 86400) + ' 天前';
  const pad = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
         ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

function fullTime(sec) {
  const d = new Date((sec || 0) * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
         ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
}

function avatarStyle(id) {
  let h = 0;
  const s = String(id || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  const h1 = h % 360;
  const h2 = (h1 + 40 + (h >>> 3) % 70) % 360;
  return { background: `linear-gradient(135deg, hsl(${h1} 72% 62%), hsl(${h2} 66% 46%))` };
}

// ============ PostCard：一张帖子的完整卡片，持有卡片级图片缓存 ============
const PostCard = {
  name: 'PostCard',
  props: { post: { type: Object, required: true } },
  setup(props) {
    const app = inject('app');
    const postId = props.post.postId;
    const media = props.post.mediaContent;

    // 卡片级图片缓存：key = sha@mode（缩略图与原图共用），随卡片卸载整体释放
    const cache = reactive(new Map());
    const loadingKeys = new Set();
    const expanded = reactive({});
    const expCarousel = reactive({ postId: null, dx: 0, dragging: false, snapping: false, width: 0 });
    const expHeight = reactive({});
    const singleImg = reactive({ w: 0, h: 0, ready: false, loaded: false });
    const stageLoaded = ref(false);
    const menuOpen = ref(false);
    let expStart = 0;
    let expStartY = 0;
    let suppressClick = false;

    function imgUrl(sha, mode) {
      const key = sha + (mode ? '@' + mode : '');
      if (cache.has(key)) return cache.get(key);
      if (!loadingKeys.has(key)) {
        loadingKeys.add(key);
        Api.mediaBlob(sha, mode)
          .then((blob) => cache.set(key, URL.createObjectURL(blob)))
          .catch(() => cache.set(key, ''));
      }
      return '';
    }

    onUnmounted(() => {
      window.removeEventListener('resize', measureSingle);
      for (const url of cache.values()) {
        if (url) URL.revokeObjectURL(url);
      }
      cache.clear();
    });

    function swallowNextClick() {
      suppressClick = true;
      setTimeout(() => { suppressClick = false; }, 350);
    }

    // ---- 卡片内大图 ----
    function expList() { return media; }
    function expSha() { return media[expanded[postId] ?? 0]?.sha256 || ''; }
    function expNextSha() { return media[(expanded[postId] ?? 0) + 1]?.sha256 || ''; }
    function expPrevSha() {
      const i = (expanded[postId] ?? 0) - 1;
      return i >= 0 ? (media[i]?.sha256 || '') : '';
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
      return h ? { height: h + 'px' } : {};
    }
    function applyExpHeight(maxRatio) {
      if (!maxRatio) return;
      const el = document.querySelector(`.post-expand[data-post="${postId}"] .exp-stage`);
      const width = el ? el.clientWidth : 300;
      expHeight[postId] = Math.round(Math.min(window.innerHeight * 0.72, width * maxRatio));
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
        transition: c.snapping ? 'transform .22s ease' : 'none',
      };
    }
    function expNextStyle() {
      const c = expCarousel;
      if (c.postId !== postId || !c.dragging || c.dx >= 0) return { display: 'none' };
      return {
        transform: `translateX(calc(100% + ${c.dx}px))`,
        transition: c.snapping ? 'transform .22s ease' : 'none',
      };
    }
    function expPrevStyle() {
      const c = expCarousel;
      if (c.postId !== postId || !c.dragging || c.dx <= 0) return { display: 'none' };
      return {
        transform: `translateX(calc(-100% + ${c.dx}px))`,
        transition: c.snapping ? 'transform .22s ease' : 'none',
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
      const stage = e.currentTarget.querySelector('.exp-stage');
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
    function onExpTouchEnd() { expFinishDrag(); }
    function onExpTouchCancel() { expResetDrag(); }

    function onExpMouseDown(e) {
      if (expCarousel.dragging) return;
      const stage = e.currentTarget.querySelector('.exp-stage');
      expStartDrag(e.clientX, stage ? stage.clientWidth : 300);
      window.addEventListener('mousemove', onExpMouseMove);
      window.addEventListener('mouseup', onExpMouseUp);
    }
    function onExpMouseMove(e) {
      if (!expCarousel.dragging) return;
      expCarousel.dx = e.clientX - expStart;
    }
    function onExpMouseUp() {
      window.removeEventListener('mousemove', onExpMouseMove);
      window.removeEventListener('mouseup', onExpMouseUp);
      expFinishDrag();
    }

    const gridClass = (list) => list.length === 1 ? 'grid single' : 'grid';
    function singleAspect(m) {
      return m.width && m.height ? { aspectRatio: m.width + ' / ' + m.height } : {};
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
    function onExpImgLoad() {
      stageLoaded.value = true;
    }

    function openMenu() {
      menuOpen.value = true;
    }
    function closeMenu() {
      menuOpen.value = false;
    }
    function favorite() {
      menuOpen.value = false;
      app.showInfo('收藏', '收藏功能开发中，敬请期待');
    }
    function openPost() {
      menuOpen.value = false;
      location.href = location.origin + '/posts/' + postId;
    }
    function copyTextFallback(text) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try {
        ok = document.execCommand('copy');
      } catch {}
      document.body.removeChild(ta);
      return ok;
    }
    async function copyLink() {
      menuOpen.value = false;
      const url = location.origin + '/posts/' + postId;
      try {
        const ok = (navigator.clipboard && window.isSecureContext)
          ? (await navigator.clipboard.writeText(url), true)
          : copyTextFallback(url);
        app.showToast(ok ? '链接已复制' : '复制失败，请手动复制');
      } catch {
        app.showToast('复制失败，请手动复制');
      }
    }
    function menuDelete() {
      menuOpen.value = false;
      app.removePost(postId);
    }

    onMounted(() => {
      nextTick(measureSingle);
      window.addEventListener('resize', measureSingle);
    });

    return {
      post: props.post,
      me: app.me, comments: app.comments, commentText: app.commentText,
      sendingComment: app.sendingComment,
      removePost: app.removePost, openLightbox: app.openLightbox,
      sendComment: app.sendComment, onCommentInput: app.onCommentInput,
      onCommentKeydown: app.onCommentKeydown, removeComment: app.removeComment,
      toggleTime: app.toggleTime, displayTime: app.displayTime,
      avatarStyle, fmtTime, fullTime, gridClass,
      singleAspect, singleImg, onSingleLoad,
      stageLoaded, onExpImgLoad,
      menuOpen, openMenu, closeMenu, favorite, copyLink, menuDelete,
      openPost,
      imgUrl, media, expanded,
      expSha, expNextSha, expPrevSha, expStep, collapse,
      expStageStyle, expCurrentStyle, expNextStyle, expPrevStyle,
      openExpanded, onExpTouchStart, onExpTouchMove, onExpTouchEnd, onExpTouchCancel,
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
      <div v-if="typeof expanded[post.postId] === 'number'" class="post-expand"
           @touchstart="onExpTouchStart($event)"
           @touchmove="onExpTouchMove"
           @touchend="onExpTouchEnd"
           @touchcancel="onExpTouchCancel"
           @mousedown.prevent="onExpMouseDown($event)">
        <div class="exp-stage" :class="{ 'stage-loaded': stageLoaded }"
             :data-post="post.postId" :style="expStageStyle()">
          <img v-if="expPrevSha()" class="exp-img" :src="imgUrl(expPrevSha(), 'medium')"
               :style="expPrevStyle()" draggable="false">
          <img class="exp-img" :src="imgUrl(expSha(), 'medium')" @load="onExpImgLoad"
               :style="expCurrentStyle()" draggable="false"
               @click="collapse()">
          <img v-if="expNextSha()" class="exp-img" :src="imgUrl(expNextSha(), 'medium')"
               :style="expNextStyle()" draggable="false">
        </div>
        <div class="expand-bar">
          <button class="ghost small" @click="collapse()">收起</button>
          <span class="exp-count">{{ (expanded[post.postId] ?? 0) + 1 }} / {{ media.length }}</span>
          <button class="primary small" @click="openLightbox(post.postId, expanded[post.postId] ?? 0)">⛶ 大图</button>
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
             @click="openExpanded(i)">
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

createApp({
  components: { PostCard },
  setup() {
    const token = ref(Api.token);
    const tokenFocus = ref(false);
    const pathname = location.pathname;
    const isAuthPage = pathname === '/auth';
    const isSingle = /^\/posts\/[^/]+$/.test(pathname);
    const singlePostId = isSingle ? decodeURIComponent(pathname.split('/')[2]) : null;

    // 未认证：非 /auth 一律跳登录页（带 next 回跳）
    if (!Api.token && !isAuthPage) {
      location.replace('/auth?next=' + encodeURIComponent(pathname + location.search));
    }
    // 已认证且访问 /auth：跳到 next 或根
    if (Api.token && isAuthPage) {
      const next = new URLSearchParams(location.search).get('next');
      location.replace(next || '/');
    }

    const DRAFT_POST = 'ms_draft_post';
    const draftCommentKey = (postId) => 'ms_draft_comment_' + postId;
    const draftTimers = {};
    const commentTimers = {};
    const me = ref(null);
    const posts = ref([]);
    const page = ref(parseInt(new URLSearchParams(location.search).get('page') || '', 10) || 1);
    const totalPages = ref(1);
    const loading = ref(false);
    const error = ref('');
    const lightbox = reactive({ show: false, postId: null, items: [], index: 0 });
    const draft = reactive({ text: '', files: [], previews: [], statuses: [], uploading: false });
    draft.text = localStorage.getItem(DRAFT_POST) || '';
    const comments = reactive({});
    const timeMode = reactive({});
    const commentText = reactive({});
    const sendingComment = reactive({});
    const fileInput = ref(null);
    const confirmState = reactive({ show: false, title: '', message: '', action: null });
    const info = reactive({ show: false, title: '', message: '' });
    const toast = reactive({ show: false, message: '' });
    let toastTimer = null;
    function showToast(message) {
      toast.message = message;
      toast.show = true;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { toast.show = false; }, 2200);
    }
    function showInfo(title, message) {
      info.title = title;
      info.message = message;
      info.show = true;
    }
    function closeInfo() {
      info.show = false;
    }

    // ---- 全屏大图（根级，独立缓存，关闭时释放） ----
    const lbCache = reactive(new Map());
    const lbLoading = new Set();
    function lbImgUrl(sha) {
      if (!sha) return '';
      if (lbCache.has(sha)) return lbCache.get(sha);
      if (!lbLoading.has(sha)) {
        lbLoading.add(sha);
        Api.mediaBlob(sha)
          .then((blob) => {
            const old = lbCache.get(sha);
            if (old) URL.revokeObjectURL(old);
            lbCache.set(sha, URL.createObjectURL(blob));
          })
          .catch(() => lbCache.set(sha, ''));
      }
      return '';
    }

    function openLightbox(postId, index) {
      const p = posts.value.find((x) => x.postId === postId);
      if (!p || !p.mediaContent.length) return;
      clearTimeout(tapCloseTimer);
      lastTap = 0;
      lightbox.postId = postId;
      lightbox.items = p.mediaContent.map((m) => ({ type: 'sha', sha: m.sha256 }));
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
      lightbox.items = draft.previews.map((url) => ({ type: 'url', url }));
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
      if (!it) return '';
      return it.type === 'url' ? it.url : lbImgUrl(it.sha);
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
    }

    let suppressClick = false;
    function swallowNextClick() {
      suppressClick = true;
      setTimeout(() => { suppressClick = false; }, 350);
    }

    const lbZoom = reactive({
      scale: 1, tx: 0, ty: 0, anim: false, fading: false,
      box: { w: 0, h: 0 }, stage: { w: 0, h: 0, left: 0, top: 0 },
    });
    let lastTap = 0;
    let tapCloseTimer = null;

    function measureLb() {
      const el = document.querySelector('.lb-stage img');
      if (!el) return;
      const stage = el.parentElement;
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
      if (s1 <= 1 && !allowBelowOne) { lbZoom.tx = 0; lbZoom.ty = 0; }
      lbZoom.anim = animate;
      if (animate) setTimeout(() => { lbZoom.anim = false; }, 220);
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
        transformOrigin: 'center',
        opacity,
        transition: lbZoom.anim ? 'transform .2s ease, opacity .2s ease' : 'none',
        cursor: lbZoom.scale > 1 ? 'grab' : 'zoom-in',
      };
    }
    function fadeOutAndClose() {
      lbZoom.fading = true;
      lbZoom.anim = true;
      lbZoom.scale = 0.5;
      setTimeout(() => { lbZoom.anim = false; }, 160);
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
        e.preventDefault();
        lbTouch.moved = true;
        const dist = Math.hypot(t[1].clientX - t[0].clientX, t[1].clientY - t[0].clientY);
        if (lbTouch.dist > 0) {
          const anchor = lbStagePoint(
            (t[0].clientX + t[1].clientX) / 2,
            (t[0].clientY + t[1].clientY) / 2);
          setZoom(lbZoom.scale * dist / lbTouch.dist, lbZoom.tx, lbZoom.ty, false, anchor, true);
        }
        lbTouch.x1 = t[0].clientX; lbTouch.y1 = t[0].clientY;
        lbTouch.x2 = t[1].clientX; lbTouch.y2 = t[1].clientY;
        lbTouch.dist = dist;
      } else if (t.length === 1 && lbZoom.scale > 1) {
        e.preventDefault();
        lbTouch.moved = true;
        lbZoom.tx += t[0].clientX - lbTouch.x1;
        lbZoom.ty += t[0].clientY - lbTouch.y1;
        lbClamp();
        lbTouch.x1 = t[0].clientX; lbTouch.y1 = t[0].clientY;
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
        } else {
          const dx = t[0].clientX - lbTouch.x1;
          if (Math.abs(dx) > 50) {
            lbStep(dx < 0 ? 1 : -1);
            swallowNextClick();
          }
        }
        lbTouch = null;
      } else if (e.touches.length === 1) {
        lbTouch.x1 = e.touches[0].clientX;
        lbTouch.y1 = e.touches[0].clientY;
        lbTouch.x2 = null; lbTouch.y2 = null; lbTouch.dist = 0; lbTouch.moved = false;
      }
    }
    function onLbTouchCancel() {
      lbTouch = null;
    }

    const drag = { on: false, x: 0, y: 0, moved: false };
    function onLbMouseDown(e) {
      suppressClick = false;
      drag.on = true;
      drag.moved = false;
      drag.x = e.clientX;
      drag.y = e.clientY;
      window.addEventListener('mousemove', onLbMouseMove);
      window.addEventListener('mouseup', onLbMouseUp);
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
      } else if (Math.abs(dx) > 60) {
        drag.on = false;
        drag.moved = true;
        lbStep(dx < 0 ? 1 : -1);
        swallowNextClick();
        window.removeEventListener('mousemove', onLbMouseMove);
        window.removeEventListener('mouseup', onLbMouseUp);
      }
    }
    function onLbMouseUp() {
      if (drag.moved) swallowNextClick();
      drag.on = false;
      drag.moved = false;
      window.removeEventListener('mousemove', onLbMouseMove);
      window.removeEventListener('mouseup', onLbMouseUp);
    }

    window.addEventListener('keydown', (e) => {
      if (!lightbox.show) return;
      if (e.key === 'Escape') closeLightbox();
      else if (e.key === 'ArrowRight') lbStep(1);
      else if (e.key === 'ArrowLeft') lbStep(-1);
    });

    // ---- 评论 / 时间 ----
    function toggleTime(key) {
      timeMode[key] = !timeMode[key];
    }
    function displayTime(key, sec) {
      return timeMode[key] ? fullTime(sec) : fmtTime(sec);
    }

    function ringStyle(p) {
      const deg = Math.round(p * 360);
      return {
        background: `conic-gradient(#fff 0deg ${deg}deg, rgba(255,255,255,.2) ${deg}deg 360deg)`,
      };
    }

    function snippet(text) {
      const t = (text || '').trim().replace(/\s+/g, ' ');
      if (!t) return '（纯图片动态）';
      return t.length <= 20 ? t : t.slice(0, 20) + '...';
    }

    function openConfirm(title, message, action) {
      confirmState.title = title;
      confirmState.message = message;
      confirmState.action = action;
      confirmState.show = true;
    }
    function confirmNo() {
      confirmState.show = false;
      confirmState.action = null;
    }
    function confirmYes() {
      const fn = confirmState.action;
      confirmState.show = false;
      confirmState.action = null;
      if (fn) fn();
    }

    async function loadFeed() {
      if (loading.value) return;
      loading.value = true;
      error.value = '';
      try {
        if (isSingle) {
          posts.value = [await Api.post(singlePostId)];
        } else {
          const meta = await Api.postMetadata();
          totalPages.value = Math.max(1, Math.ceil(meta.totalCount / 10));
          if (page.value > totalPages.value) page.value = totalPages.value;
          syncPageUrl();
          posts.value = (await Api.listPosts(page.value)).items;
        }
        await Promise.all(posts.value.map(async (p) => {
          try {
            comments[p.postId] = (await Api.comments(p.postId)).items;
          } catch {
            comments[p.postId] = [];
          }
        }));
        posts.value.forEach((p) => {
          if (commentText[p.postId] === undefined) {
            const v = localStorage.getItem(draftCommentKey(p.postId));
            if (v != null) commentText[p.postId] = v;
          }
        });
      } catch (e) {
        error.value = e.message;
      } finally {
        loading.value = false;
      }
    }

    function goPage(p) {
      if (p < 1 || p > totalPages.value || p === page.value) return;
      page.value = p;
      syncPageUrl();
      loadFeed();
    }
    function syncPageUrl() {
      const url = new URL(location.href);
      if (page.value > 1) url.searchParams.set('page', page.value);
      else url.searchParams.delete('page');
      history.replaceState(null, '', url.toString());
    }
    function goBack() {
      // 同源来源（如从 feed 打开）→ 浏览器后退，保留原页码；直接访问 → 回首页
      if (document.referrer && document.referrer.startsWith(location.origin)) history.back();
      else location.href = '/';
    }

    async function login() {
      const t = token.value.trim();
      if (!t) return;
      if (!/^[\x00-\x7F]+$/.test(t)) {
        error.value = 'token 只能包含 ASCII 字符';
        return;
      }
      try {
        Api.token = t;
        localStorage.setItem('ms_token', t);
        me.value = await Api.login();
        error.value = '';
        if (isAuthPage) {
          const next = new URLSearchParams(location.search).get('next');
          location.replace(next || '/');
          return;
        }
        await loadFeed();
      } catch (e) {
        Api.token = '';
        localStorage.removeItem('ms_token');
        me.value = null;
        error.value = e.message;
        if (!isAuthPage) {
          location.replace('/auth?next=' + encodeURIComponent(pathname + location.search));
        }
      }
    }
    function logout() {
      Api.token = '';
      localStorage.removeItem('ms_token');
      me.value = null;
      posts.value = [];
      page.value = 1;
      syncPageUrl();
      location.replace('/auth');
    }

    function onPick(e) {
      for (const f of e.target.files) {
        if (!f.type.startsWith('image/')) continue;
        draft.files.push(f);
        draft.previews.push(URL.createObjectURL(f));
        draft.statuses.push('done');
      }
      e.target.value = '';
    }
    function removeDraft(i) {
      URL.revokeObjectURL(draft.previews[i]);
      draft.files.splice(i, 1);
      draft.previews.splice(i, 1);
      draft.statuses.splice(i, 1);
    }
    async function submitPost() {
      const text = draft.text.trim();
      if (!text && !draft.files.length) return;
      draft.uploading = true;
      error.value = '';
      draft.statuses = draft.files.map(() => 'pending');
      try {
        const mediaContent = [];
        for (let i = 0; i < draft.files.length; i++) {
          draft.statuses[i] = 0;
          let m;
          try {
            m = await Api.upload(draft.files[i], (p) => { draft.statuses[i] = p; });
          } catch (e) {
            draft.statuses[i] = 'pending';
            throw e;
          }
          draft.statuses[i] = 'done';
          mediaContent.push(m.sha256);
        }
        await Api.createPost(text, mediaContent);
        draft.text = '';
        clearTimeout(draftTimers[DRAFT_POST]);
        localStorage.removeItem(DRAFT_POST);
        const composerEl = document.querySelector('textarea[data-composer]');
        if (composerEl) composerEl.style.height = 'auto';
        draft.previews.forEach((u) => URL.revokeObjectURL(u));
        draft.files = [];
        draft.previews = [];
        draft.statuses = [];
        await loadFeed();
      } catch (e) {
        error.value = e.message;
      } finally {
        draft.uploading = false;
      }
    }

    async function sendComment(postId) {
      const content = (commentText[postId] || '').trim();
      if (!content) return;
      sendingComment[postId] = true;
      try {
        const c = await Api.addComment(postId, content);
        (comments[postId] ||= []).unshift(c);
        commentText[postId] = '';
        clearTimeout(commentTimers[draftCommentKey(postId)]);
        localStorage.removeItem(draftCommentKey(postId));
        const el = document.querySelector(`.comment-box textarea[data-post="${postId}"]`);
        if (el) el.style.height = 'auto';
      } catch (e) {
        error.value = e.message;
      } finally {
        sendingComment[postId] = false;
      }
    }

    function growComment(e) {
      const el = e.target;
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, 120) + 'px';
    }
    function growDraft(e) {
      const el = e.target;
      el.style.height = 'auto';
      el.style.height = el.scrollHeight + 'px';
    }
    function saveSoon(key, value, timers) {
      clearTimeout(timers[key]);
      timers[key] = setTimeout(() => {
        try { localStorage.setItem(key, value); } catch {}
      }, 1000);
    }
    function onDraftInput(e) {
      growDraft(e);
      saveSoon(DRAFT_POST, draft.text, draftTimers);
    }
    function onCommentInput(postId, e) {
      growComment(e);
      saveSoon(draftCommentKey(postId), commentText[postId], commentTimers);
    }
    function onCommentKeydown(postId, e) {
      if (e.isComposing) return;
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendComment(postId);
      }
    }

    function removeComment(postId, commentId) {
      const c = (comments[postId] || []).find((x) => x.commentId === commentId);
      openConfirm('删除评论', `删除后不可恢复要删除 「${snippet(c?.content)}」 吗？`, async () => {
        try {
          await Api.deleteComment(commentId);
          comments[postId] = (comments[postId] || []).filter((x) => x.commentId !== commentId);
        } catch (e) {
          error.value = e.message;
        }
      });
    }
    function removePost(postId) {
      const p = posts.value.find((x) => x.postId === postId);
      openConfirm('删除动态', `删除后不可恢复。确认要删除 「${snippet(p?.textContent)}」 吗？`, async () => {
        try {
          await Api.deletePost(postId);
          if (isSingle) {
            location.href = '/';
            return;
          }
          if (posts.value.length === 1 && page.value > 1) page.value--;
          await loadFeed();
        } catch (e) {
          error.value = e.message;
        }
      });
    }

    provide('app', {
      me, comments, commentText, sendingComment,
      removePost, openLightbox,
      sendComment, onCommentInput, onCommentKeydown, removeComment,
      toggleTime, displayTime, showToast, showInfo,
    });

    if (Api.token) login();

    return {
      token, tokenFocus, me, posts, page, totalPages, loading, error, lightbox,
      isAuthPage, isSingle,
      goBack,
      toast, info, closeInfo,
      draft, fileInput,
      login, logout, loadFeed, goPage, onPick, removeDraft, submitPost,
      onDraftInput, ringStyle,
      confirmState, confirmNo, confirmYes,
      lbImgUrl, currentSrc, openPreview, lbCan, lbStep, closeLightbox,
      onLbTouchStart, onLbTouchMove, onLbTouchEnd, onLbTouchCancel,
      onLbMouseDown, onLbWheel, onImgClick, lbImgStyle, measureLb,
    };
  },
  template: `
    <div v-if="me && !isSingle" class="wrap">
      <div class="feed">
        <header class="topbar">
          <div class="brand">MiniSpace <span class="ver">v60</span></div>
          <div class="who">{{ me.nickname }} <button class="link" @click="logout">退出</button></div>
        </header>

        <div class="composer card">
          <textarea v-model="draft.text" rows="3" maxlength="10000" placeholder="分享新鲜事…"
                    data-composer @input="onDraftInput"></textarea>
          <div class="picker-grid">
            <div v-for="(p, i) in draft.previews" :key="i" class="cell">
              <img :src="p" @click="openPreview(i)">
              <button class="x" :disabled="draft.uploading" @click="removeDraft(i)">×</button>
              <div v-if="draft.statuses[i] !== 'done'" class="upload-mask">
                <div v-if="typeof draft.statuses[i] === 'number'" class="ring"
                     :style="ringStyle(draft.statuses[i])">
                  <div class="ring-hole"></div>
                  <span class="ring-pct">{{ Math.round(draft.statuses[i] * 100) }}%</span>
                </div>
              </div>
            </div>
            <button class="add-cell" title="添加图片" :disabled="draft.uploading"
                    @click="fileInput.click()">＋</button>
          </div>
          <div class="actions">
            <input ref="fileInput" type="file" accept="image/*" multiple hidden @change="onPick">
            <button class="primary" :disabled="draft.uploading || (!draft.text.trim() && !draft.files.length)"
                    @click="submitPost">{{ draft.uploading ? '发布中…' : '发布' }}</button>
          </div>
        </div>

        <p v-if="error" class="error">{{ error }}</p>

        <post-card v-for="p in posts" :key="p.postId" :post="p"></post-card>

        <div v-if="totalPages > 1" class="pager">
          <button class="ghost" :disabled="page <= 1 || loading" @click="goPage(page - 1)">上一页</button>
          <span class="page-info">{{ page }} / {{ totalPages }}</span>
          <button class="ghost" :disabled="page >= totalPages || loading" @click="goPage(page + 1)">下一页</button>
        </div>
        <p v-if="!posts.length && !loading" class="empty">还没有动态，发一条吧</p>
      </div>
    </div>

    <div v-else-if="me && isSingle" class="single-page">
      <header class="topbar single">
        <a class="link back" href="/" @click.prevent="goBack">← 返回</a>
        <div class="who">{{ me.nickname }} <button class="link" @click="logout">退出</button></div>
      </header>
      <div class="wrap">
        <div class="feed">
          <p v-if="error" class="error">{{ error }}</p>
          <post-card v-for="p in posts" :key="p.postId" :post="p"></post-card>
        </div>
      </div>
    </div>

    <div v-else-if="isAuthPage" class="login">
        <h1>MiniSpace <span class="ver">v60</span></h1>
        <p class="sub">填入你的访问 token 进入</p>
        <div class="login-box">
          <input v-model="token" :placeholder="tokenFocus ? '' : 'token'" autocomplete="off"
                 @focus="tokenFocus = true" @blur="tokenFocus = false"
                 @keyup.enter="login">
          <button class="primary" @click="login">进入</button>
        </div>
        <p v-if="error" class="error">{{ error }}</p>
      </div>

    <div v-else class="route-wait"></div>

    <transition name="toast">
      <div v-if="toast.show" class="toast">{{ toast.message }}</div>
    </transition>

      <div v-if="lightbox.show" class="lightbox"
           @click="closeLightbox"
           @touchstart="onLbTouchStart" @touchmove="onLbTouchMove"
           @touchend="onLbTouchEnd" @touchcancel="onLbTouchCancel"
           @mousedown.prevent="onLbMouseDown" @wheel.prevent="onLbWheel">
        <div class="lb-stage">
          <transition name="lb-slide" mode="out-in">
            <img :key="lightbox.index" :src="currentSrc()" :style="lbImgStyle()"
                 @load="measureLb" @click.stop="onImgClick">
          </transition>
        </div>
        <button v-if="lightbox.items.length > 1" class="lb-nav prev" :class="{ off: !lbCan(-1) }"
                :disabled="!lbCan(-1)" @click.stop="lbStep(-1)">‹</button>
        <button v-if="lightbox.items.length > 1" class="lb-nav next" :class="{ off: !lbCan(1) }"
                :disabled="!lbCan(1)" @click.stop="lbStep(1)">›</button>
        <span class="lb-count">{{ lightbox.index + 1 }} / {{ lightbox.items.length }}</span>
      </div>

      <div v-if="confirmState.show" class="modal-mask" @click.self="confirmNo">
        <div class="modal">
          <h3>{{ confirmState.title }}</h3>
          <p>{{ confirmState.message }}</p>
          <div class="modal-actions">
            <button class="ghost" @click="confirmNo">取消</button>
            <button class="primary danger" @click="confirmYes">删除</button>
          </div>
        </div>
      </div>

      <div v-if="info.show" class="modal-mask" @click.self="closeInfo">
        <div class="modal">
          <h3>{{ info.title }}</h3>
          <p>{{ info.message }}</p>
          <div class="modal-actions">
            <button class="primary" @click="closeInfo">确定</button>
          </div>
        </div>
      </div>
  `,
}).mount('#app');
