const { createApp, ref, reactive } = Vue;

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

createApp({
  setup() {
    const token = ref(Api.token);
    const me = ref(null);
    const posts = ref([]);
    const page = ref(1);
    const totalPages = ref(1);
    const loading = ref(false);
    const error = ref('');
    const lightbox = ref('');
    const expanded = reactive({});
    const draft = reactive({ text: '', files: [], previews: [], uploading: false });
    const comments = reactive({});
    const timeMode = reactive({});
    const commentText = reactive({});
    const sendingComment = reactive({});
    const imgCache = reactive({});
    const loadingImgs = new Set();
    const fileInput = ref(null);

    const gridClass = (list) => list.length === 1 ? 'grid single' : 'grid';

    function imgUrl(sha) {
      if (imgCache[sha]) return imgCache[sha];
      if (!loadingImgs.has(sha)) {
        loadingImgs.add(sha);
        Api.mediaBlob(sha)
          .then((blob) => { imgCache[sha] = URL.createObjectURL(blob); })
          .catch(() => { imgCache[sha] = ''; });
      }
      return '';
    }

    function collapse(postId) {
      expanded[postId] = null;
    }

    function toggleTime(key) {
      timeMode[key] = !timeMode[key];
    }

    function displayTime(key, sec) {
      return timeMode[key] ? fullTime(sec) : fmtTime(sec);
    }

    async function loadFeed() {
      if (loading.value) return;
      loading.value = true;
      error.value = '';
      try {
        const meta = await Api.postMetadata();
        totalPages.value = Math.max(1, Math.ceil(meta.totalCount / 10));
        if (page.value > totalPages.value) page.value = totalPages.value;
        posts.value = (await Api.listPosts(page.value)).items;
        await Promise.all(posts.value.map(async (p) => {
          try {
            comments[p.postId] = (await Api.comments(p.postId)).items;
          } catch {
            comments[p.postId] = [];
          }
        }));
      } catch (e) {
        error.value = e.message;
      } finally {
        loading.value = false;
      }
    }

    function goPage(p) {
      if (p < 1 || p > totalPages.value || p === page.value) return;
      page.value = p;
      loadFeed();
    }

    async function login() {
      const t = token.value.trim();
      if (!t) return;
      try {
        Api.token = t;
        localStorage.setItem('ms_token', t);
        me.value = await Api.login();
        error.value = '';
        await loadFeed();
      } catch (e) {
        Api.token = '';
        localStorage.removeItem('ms_token');
        me.value = null;
        error.value = e.message;
      }
    }

    function logout() {
      Api.token = '';
      localStorage.removeItem('ms_token');
      me.value = null;
      posts.value = [];
      page.value = 1;
    }

    function onPick(e) {
      for (const f of e.target.files) {
        if (!f.type.startsWith('image/')) continue;
        draft.files.push(f);
        draft.previews.push(URL.createObjectURL(f));
      }
      e.target.value = '';
    }

    function removeDraft(i) {
      URL.revokeObjectURL(draft.previews[i]);
      draft.files.splice(i, 1);
      draft.previews.splice(i, 1);
    }

    async function submitPost() {
      const text = draft.text.trim();
      if (!text && !draft.files.length) return;
      draft.uploading = true;
      error.value = '';
      try {
        const mediaContent = [];
        for (const f of draft.files) {
          const m = await Api.upload(f);
          mediaContent.push(m.sha256);
        }
        await Api.createPost(text, mediaContent);
        draft.text = '';
        draft.previews.forEach((u) => URL.revokeObjectURL(u));
        draft.files = [];
        draft.previews = [];
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
      } catch (e) {
        error.value = e.message;
      } finally {
        sendingComment[postId] = false;
      }
    }

    async function removeComment(postId, commentId) {
      if (!confirm('删除这条评论？')) return;
      try {
        await Api.deleteComment(commentId);
        comments[postId] = (comments[postId] || []).filter((c) => c.commentId !== commentId);
      } catch (e) {
        error.value = e.message;
      }
    }

    async function removePost(postId) {
      if (!confirm('删除这条动态？')) return;
      try {
        await Api.deletePost(postId);
        if (posts.value.length === 1 && page.value > 1) page.value--;
        await loadFeed();
      } catch (e) {
        error.value = e.message;
      }
    }

    if (Api.token) login();

    return {
      token, me, posts, page, totalPages, loading, error, lightbox,
      expanded, collapse,
      draft, comments, commentText, sendingComment, fileInput,
      login, logout, loadFeed, goPage, onPick, removeDraft, submitPost,
      sendComment, removeComment, removePost, imgUrl, fmtTime, fullTime,
      toggleTime, displayTime, gridClass,
    };
  },
  template: `
    <div class="wrap">
      <div v-if="!me" class="login card">
        <h1>MiniSpace</h1>
        <p class="sub">填入你的访问 token 进入</p>
        <input v-model="token" placeholder="token" @keyup.enter="login">
        <button class="primary" @click="login">进入</button>
        <p v-if="error" class="error">{{ error }}</p>
      </div>

      <div v-else class="feed">
        <header class="topbar">
          <div class="brand">MiniSpace</div>
          <div class="who">{{ me.nickname }} <button class="link" @click="logout">退出</button></div>
        </header>

        <div class="composer card">
          <textarea v-model="draft.text" rows="3" maxlength="10000" placeholder="分享新鲜事…"></textarea>
          <div class="picker-grid">
            <div v-for="(p, i) in draft.previews" :key="i" class="cell">
              <img :src="p">
              <button class="x" @click="removeDraft(i)">×</button>
            </div>
            <button class="add-cell" title="添加图片" @click="fileInput.click()">＋</button>
          </div>
          <div class="actions">
            <input ref="fileInput" type="file" accept="image/*" multiple hidden @change="onPick">
            <button class="primary" :disabled="draft.uploading || (!draft.text.trim() && !draft.files.length)"
                    @click="submitPost">{{ draft.uploading ? '发布中…' : '发布' }}</button>
          </div>
        </div>

        <p v-if="error" class="error">{{ error }}</p>

        <article v-for="p in posts" :key="p.postId" class="post card">
          <header>
            <span class="avatar">{{ p.nickname[0] }}</span>
            <div class="meta">
              <div class="nick">{{ p.nickname }}</div>
              <div class="time" @click="toggleTime('p:' + p.postId)">
                {{ displayTime('p:' + p.postId, p.createdAt) }}
              </div>
            </div>
            <button v-if="p.userId === me.userId" class="link del" @click="removePost(p.postId)">删除</button>
          </header>
          <p class="text">{{ p.textContent }}</p>
          <div v-if="expanded[p.postId]" class="post-expand">
            <img :src="imgUrl(expanded[p.postId])" @click="collapse(p.postId)">
            <div class="expand-bar">
              <button class="ghost small" @click="collapse(p.postId)">收起</button>
              <button class="primary small" @click="lightbox = imgUrl(expanded[p.postId])">⛶ 大图</button>
            </div>
          </div>
          <div v-else-if="p.mediaContent.length" :class="gridClass(p.mediaContent)">
            <img v-for="sha in p.mediaContent" :key="sha" :src="imgUrl(sha)" loading="lazy"
                 @click="expanded[p.postId] = sha">
          </div>
          <div class="comments">
            <p v-if="!(comments[p.postId] || []).length" class="no-comment">还没有评论</p>
            <div v-for="c in comments[p.postId] || []" :key="c.commentId" class="comment">
              <b>{{ c.nickname }}</b>{{ c.content }}
              <button v-if="c.userId === me.userId" class="link del small-del"
                      @click="removeComment(p.postId, c.commentId)">删除</button>
              <div class="time" @click="toggleTime('c:' + c.commentId)">
                {{ displayTime('c:' + c.commentId, c.createdAt) }}
              </div>
            </div>
            <div class="comment-box">
              <input v-model="commentText[p.postId]" maxlength="500" placeholder="写评论…"
                     @keyup.enter="sendComment(p.postId)">
              <button class="primary small" :disabled="sendingComment[p.postId]"
                      @click="sendComment(p.postId)">发送</button>
            </div>
          </div>
        </article>

        <div v-if="totalPages > 1" class="pager">
          <button class="ghost" :disabled="page <= 1 || loading" @click="goPage(page - 1)">上一页</button>
          <span class="page-info">{{ page }} / {{ totalPages }}</span>
          <button class="ghost" :disabled="page >= totalPages || loading" @click="goPage(page + 1)">下一页</button>
        </div>
        <p v-if="!posts.length && !loading" class="empty">还没有动态，发一条吧</p>
      </div>

      <div v-if="lightbox" class="lightbox" @click="lightbox = ''">
        <img :src="lightbox">
      </div>
    </div>
  `,
}).mount('#app');
