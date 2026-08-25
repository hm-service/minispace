import { Api } from './api.js?v=70';
import { fmtTime, fullTime, avatarStyle } from './utils.js?v=70';
import { PostCard } from './post-card.js?v=70';
import { useLightbox } from './use-lightbox.js?v=70';

const { createApp, ref, reactive, provide } = Vue;
const FRONTEND_VERSION = 'v70';
console.log('[MiniSpace] frontend', FRONTEND_VERSION);

document.addEventListener('touchmove', (e) => {
  if (e.touches.length > 1) e.preventDefault();
}, { passive: false });



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

    const lb = useLightbox(posts, draft);

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
      removePost, openLightbox: lb.openLightbox,
      sendComment, onCommentInput, onCommentKeydown, removeComment,
      toggleTime, displayTime, showToast, showInfo,
    });

    if (Api.token) login();

    return {
      token, tokenFocus, me, posts, page, totalPages, loading, error,
      ...lb,
      isAuthPage, isSingle,
      goBack,
      toast, info, closeInfo,
      draft, fileInput,
      login, logout, loadFeed, goPage, onPick, removeDraft, submitPost,
      onDraftInput, ringStyle,
      confirmState, confirmNo, confirmYes,
      version: FRONTEND_VERSION,
    };
  },
  template: `
    <div v-if="me && !isSingle" class="wrap">
      <div class="feed">
        <header class="topbar">
          <div class="brand">MiniSpace <span class="ver">{{ version }}</span></div>
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
        <h1>MiniSpace <span class="ver">{{ version }}</span></h1>
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
          <div class="lb-track">
            <div v-if="lbCan(-1)" class="lb-item" :style="lbItemStyle(-1)">
              <img :src="lbAdjacentUrl(lbSha(-1))" draggable="false">
            </div>
            <div class="lb-item current" :style="lbItemStyle(0)">
              <img :key="lightbox.index" :src="currentSrc()" :style="lbImgStyle()"
                   @load="measureLb" @click.stop="onImgClick">
            </div>
            <div v-if="lbCan(1)" class="lb-item" :style="lbItemStyle(1)">
              <img :src="lbAdjacentUrl(lbSha(1))" draggable="false">
            </div>
          </div>
        </div>
        <button v-if="lightbox.items.length > 1" class="lb-nav prev" :class="{ off: !lbCan(-1) }"
                :disabled="!lbCan(-1)" @click.stop="lbStep(-1)">
          <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
            <path d="M15 6l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2.5"
                  stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
        <button v-if="lightbox.items.length > 1" class="lb-nav next" :class="{ off: !lbCan(1) }"
                :disabled="!lbCan(1)" @click.stop="lbStep(1)">
          <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
            <path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.5"
                  stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
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
