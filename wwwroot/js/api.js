export const Api = {
  token: localStorage.getItem('ms_token') || '',

  async request(method, url, body) {
    const headers = {};
    if (this.token) headers['Authorization'] = 'Bearer ' + this.token;
    const opts = { method, headers };
    if (body !== undefined) {
      if (body instanceof FormData) {
        opts.body = body;
      } else {
        headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(body);
      }
    }
    const res = await fetch(url, opts);
    if (res.status === 204) return null;
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const err = new Error((data && (data.detail || data.message)) || '请求失败 (' + res.status + ')');
      err.status = res.status;
      throw err;
    }
    return data;
  },

  login: () => Api.request('POST', '/api/login'),
  upload: (file, onProgress) => new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/media');
    if (Api.token) xhr.setRequestHeader('Authorization', 'Bearer ' + Api.token);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      let data = null;
      try { data = JSON.parse(xhr.responseText); } catch {}
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new Error((data && (data.detail || data.message)) || '上传失败 (' + xhr.status + ')'));
    };
    xhr.onerror = () => reject(new Error('网络错误，上传失败'));
    const fd = new FormData();
    fd.append('file', file);
    xhr.send(fd);
  }),
  createPost: (textContent, mediaContent) =>
    Api.request('POST', '/api/posts', { textContent, mediaContent }),
  postMetadata: () => Api.request('GET', '/api/posts/metadata'),
  listPosts: (page) => Api.request('GET', '/api/posts?page=' + page),
  post: (postId) => Api.request('GET', '/api/posts/' + postId),
  deletePost: (postId) => Api.request('DELETE', '/api/posts/' + postId),
  comments: (postId) => Api.request('GET', '/api/comments?postId=' + encodeURIComponent(postId)),
  addComment: (postId, content) =>
    Api.request('POST', '/api/comments', { postId, content }),
  deleteComment: (commentId) => Api.request('DELETE', '/api/comments/' + commentId),

  async mediaBlob(sha256, mode) {
    const url = '/media/' + sha256 + (mode ? '@' + mode : '');
    const res = await fetch(url, {
      headers: { Authorization: 'Bearer ' + Api.token },
    });
    if (!res.ok) throw new Error('图片加载失败');
    return res.blob();
  },
};
